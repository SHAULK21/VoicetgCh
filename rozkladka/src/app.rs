//! Главный поток: скрытое окно, иконка в трее, настройки и действия горячих клавиш.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ptr::{null, null_mut};
use std::sync::atomic::Ordering;
use std::thread::sleep;
use std::time::Duration;

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::Globalization::GetLocaleInfoW;
use windows_sys::Win32::Graphics::Gdi::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::System::Threading::CreateMutexW;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::Shell::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::convert;
use crate::hook::{self, AUTO_ALL, AUTO_OFF, Action, WM_APP_ACTION};
use crate::layouts;
use crate::keymap::{Builtin, KeyMap, WinMap};
use crate::sys::{self, wide};

const WM_APP_TRAY: u32 = WM_APP + 2;
const TIMER_ID: usize = 1;

const ID_ENABLED: usize = 1;
const ID_DOUBLE_SHIFT: usize = 2;
const ID_AUTOSTART: usize = 3;
const ID_HELP: usize = 4;
const ID_EXIT: usize = 5;
const ID_EXCLUDE_APP: usize = 6;
const ID_AUTO_OFF: usize = 10;
const ID_AUTO_ALL: usize = 11;
/// ID_AUTO_TARGET + основной LANGID = «всё в этот язык».
const ID_AUTO_TARGET: usize = 0x1000;

const APP_TITLE: &str = "Раскладка";

const HELP: &str = "Раскладка — исправление текста, набранного не в той раскладке.\n\n\
НА ЛЕТУ (меню → «Исправлять на лету»): слово, набранное не в той раскладке, исправляется\n\
само после пробела, и раскладка переключается. Можно выбрать целевой язык\n\
(«Всё на украинский» и т.п.) или режим «между всеми языками».\n\
Если исправило зря — сразу нажмите Pause: слово вернётся и запомнится как исключение.\n\n\
Pause — исправить последнее слово\n      (нажмите ещё раз — следующая раскладка: англ. → укр. → рус. …)\n\
Двойной Shift — то же самое (для ноутбуков без Pause)\n\
Ctrl+Pause (Break) — исправить всю последнюю фразу\n\
Shift+Pause — исправить выделенный текст\n\
Alt+Pause — иНВЕРСИЯ рЕГИСТРА (забытый CapsLock)\n\
Alt+Shift+Pause — строчные → ПРОПИСНЫЕ → Каждое Слово\n\
Ctrl+Shift+Pause — транслитерация (Привіт ↔ Pryvit)\n\n\
Без выделения Alt/Ctrl+Shift-команды работают с последним словом.\n\
Работает с любыми установленными раскладками Windows, а в английский, украинский\n\
и русский переводит, даже если такой раскладки в Windows нет.\n\
Двойной клик по иконке в трее — включить / выключить.";

#[derive(PartialEq)]
enum SessionKey {
    Buffer { version: u64, start: usize, len: usize },
    Selection(String),
}

/// Запоминает последнюю конвертацию, чтобы повторное нажатие переходило к следующей раскладке.
struct Session {
    key: SessionKey,
    cur: isize,
    seq: Vec<isize>,
    pos: usize,
}

struct App {
    hwnd: HWND,
    shown: (isize, bool, bool),
    icons: HashMap<(u16, bool, bool), HICON>,
    last_used: HashMap<isize, u32>,
    session: Option<Session>,
    taskbar_created: u32,
    tray_added: bool,
    /// Последняя активная программа (для пункта «не исправлять в этой программе»).
    last_app: Option<String>,
}

thread_local! {
    static APP: RefCell<App> = RefCell::new(App {
        hwnd: null_mut(),
        shown: (0, true, false),
        icons: HashMap::new(),
        last_used: HashMap::new(),
        session: None,
        taskbar_created: 0,
        tray_added: false,
        last_app: None,
    });
}

fn hwnd() -> HWND {
    APP.with(|a| a.borrow().hwnd)
}

fn last_used(hkl: isize) -> u32 {
    APP.with(|a| a.borrow().last_used.get(&hkl).copied().unwrap_or(0))
}

fn primary_lang(hkl: isize) -> u16 {
    (hkl as usize & 0x3FF) as u16
}

// =============================================================================================
// Логика раскладок
// =============================================================================================

/// Таблица символов раскладки: настоящая из Windows или встроенная для неустановленной.
fn keymap_for(hkl: isize) -> Box<dyn KeyMap> {
    if layouts::is_virtual(hkl) {
        Box::new(Builtin::for_primary_lang(primary_lang(hkl)).unwrap_or_else(Builtin::en))
    } else {
        Box::new(WinMap::new(hkl))
    }
}

/// Установленные раскладки + виртуальные EN / UK / RU, которых нет в Windows
/// (в них нельзя переключиться, но можно перепечатать текст их буквами).
fn all_layouts() -> Vec<isize> {
    let mut list = sys::installed_layouts();
    list.extend(layouts::virtual_hkls(&list));
    list
}

/// Грубо «алфавит» раскладки: 1 — латиница, 2 — кириллица, иначе — сам символ.
fn script_of(hkl: isize) -> u32 {
    match keymap_for(hkl).render(0x1E, false, false) {
        Some(c) if c.is_ascii_alphabetic() => 1,
        Some(c) if ('\u{0400}'..='\u{04FF}').contains(&c) => 2,
        Some(c) => c as u32,
        None => 0,
    }
}

/// Порядок перебора раскладок при конвертации текста, набранного в `src`:
/// сначала последняя использованная раскладка *другого* алфавита (латиница <-> кириллица),
/// затем остальные (в том числе неустановленные EN / UK / RU) и в конце снова `src`.
/// Если в меню выбран целевой язык («Всё на русский»), он идёт первым.
fn build_seq(src: isize) -> Vec<isize> {
    let list = all_layouts();
    let others: Vec<isize> = list.iter().copied().filter(|&h| h != src).collect();
    if others.is_empty() {
        return Vec::new();
    }
    let ss = script_of(src);
    let mut best: Option<(isize, u32)> = None;
    for &h in &others {
        if script_of(h) != ss {
            let t = last_used(h);
            if best.is_none_or(|(_, bt)| t > bt) {
                best = Some((h, t));
            }
        }
    }
    let mode = hook::AUTO_MODE.load(Ordering::Relaxed);
    let target = (mode & 0x100 != 0).then_some((mode & 0x3FF) as u16);
    let preferred = target
        .and_then(|p| others.iter().copied().find(|&h| primary_lang(h) == p))
        .or(best.map(|b| b.0))
        .unwrap_or(others[0]);
    let mut seq = vec![preferred];
    seq.extend(others.iter().copied().filter(|&h| h != preferred));
    seq.push(src);
    seq
}

/// Угадать, в какой из установленных раскладок набран текст.
fn detect_source(text: &str) -> isize {
    let (_, fg_hkl) = hook::foreground_layout();
    let mut best = (0usize, false, 0u32, fg_hkl);
    for h in all_layouts() {
        let score = convert::layout_score(text, keymap_for(h).as_ref());
        let cand = (score, h == fg_hkl, last_used(h), h);
        if (cand.0, cand.1, cand.2) > (best.0, best.1, best.2) {
            best = cand;
        }
    }
    best.3
}

/// Возвращает раскладки (из, в) для конвертации, продолжая предыдущую сессию, если она совпадает.
fn next_layouts(key: SessionKey, src: impl FnOnce() -> isize) -> Option<(isize, isize)> {
    APP.with(|a| {
        let mut a = a.borrow_mut();
        if let Some(s) = a.session.as_mut()
            && s.key == key
        {
            let from = s.cur;
            s.pos = (s.pos + 1) % s.seq.len();
            s.cur = s.seq[s.pos];
            return Some((from, s.cur));
        }
        drop(a);
        let src = src();
        let seq = build_seq(src);
        let first = *seq.first()?;
        APP.with(|a| a.borrow_mut().session = Some(Session { key, cur: first, seq, pos: 0 }));
        Some((src, first))
    })
}

fn set_session_key(key: SessionKey) {
    APP.with(|a| {
        if let Some(s) = a.borrow_mut().session.as_mut() {
            s.key = key;
        }
    });
}

/// Предпочитать ли украинский русскому при транслитерации / неоднозначном тексте?
fn prefer_uk() -> bool {
    let mut cyr: Vec<(u32, u16)> = APP.with(|a| {
        a.borrow().last_used.iter().map(|(&h, &t)| (t, primary_lang(h))).filter(|&(_, l)| l == 0x22 || l == 0x19).collect()
    });
    cyr.sort();
    if let Some(&(_, l)) = cyr.last() {
        return l == 0x22;
    }
    let installed: Vec<u16> = sys::installed_layouts().into_iter().map(primary_lang).collect();
    installed.contains(&0x22) || !installed.contains(&0x19)
}

// =============================================================================================
// Действия
// =============================================================================================

/// Число символов последнего слова (+ пробелы после него) в буфере набора.
fn last_word_len() -> usize {
    let Ok(b) = hook::BUF.lock() else { return 0 };
    let n = b.keys.len();
    let mut end = n;
    while end > 0 && b.keys[end - 1].is_space() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 && !b.keys[start - 1].is_space() {
        start -= 1;
    }
    if end == start { 0 } else { n - start }
}

/// Перепечатать последнее слово (или всю фразу) из запомненных нажатий в следующей раскладке.
fn convert_buffer(phrase: bool) {
    let job = {
        let Ok(mut b) = hook::BUF.lock() else { return };
        let n = b.keys.len();
        // Pause сразу после автоисправления = отменить его и запомнить слово.
        if let Some(u) = b.undo.take()
            && u.version == b.version
            && n == u.end + 1
        {
            let from = keymap_for(u.from);
            let mut out: String = b.keys[u.start..u.end]
                .iter()
                .map(|k| from.render(k.scan, k.shift, k.caps).unwrap_or('?'))
                .collect();
            out.push(' ');
            for k in &mut b.keys[u.start..n] {
                k.hkl = u.from;
            }
            b.set_pending(u.from);
            if let Ok(mut ex) = hook::EXCEPTIONS.lock() {
                ex.get_or_insert_with(Default::default).insert(u.word.clone());
            }
            sys::add_exception(&u.word);
            drop(b);
            sys::backspaces(n - u.start);
            sys::activate_layout(u.from);
            sys::type_text(&out);
            return;
        }
        let mut end = n;
        while end > 0 && b.keys[end - 1].is_space() {
            end -= 1;
        }
        if end == 0 {
            return;
        }
        let mut start = 0;
        if !phrase {
            start = end;
            while start > 0 && !b.keys[start - 1].is_space() {
                start -= 1;
            }
        }
        let key = SessionKey::Buffer { version: b.version, start, len: n };
        let src = b.keys[end - 1].hkl;
        let Some((_, target)) = next_layouts(key, || src) else { return };
        let to = keymap_for(target);
        let mut out = String::new();
        for k in &b.keys[start..n] {
            let c = to
                .render(k.scan, k.shift, k.caps)
                .or_else(|| keymap_for(k.hkl).render(k.scan, k.shift, k.caps))
                .unwrap_or('?');
            out.push(c);
        }
        for k in &mut b.keys[start..n] {
            k.hkl = target;
        }
        b.set_pending(target);
        (n - start, out, target)
    };
    let (erase, out, target) = job;
    sys::backspaces(erase);
    sys::activate_layout(target);
    sys::type_text(&out);
}

fn transform(action: Action, text: &str) -> Option<(String, Option<isize>)> {
    match action {
        Action::ConvertSelection => {
            let (from, to) = next_layouts(SessionKey::Selection(text.to_string()), || detect_source(text))?;
            let out = convert::convert_text(text, keymap_for(from).as_ref(), keymap_for(to).as_ref());
            set_session_key(SessionKey::Selection(out.clone()));
            Some((out, Some(to)))
        }
        Action::InvertCase => Some((convert::invert_case(text), None)),
        Action::CycleCase => Some((convert::cycle_case(text), None)),
        Action::Translit => Some((convert::translit(text, prefer_uk()), None)),
        _ => None,
    }
}

/// Редакторы вроде VS Code без выделения копируют всю строку.
fn looks_like_line_copy(t: &str) -> bool {
    t.ends_with('\n') && !t.trim_end_matches(['\r', '\n']).contains('\n')
}

fn selection_action(action: Action, allow_fallback: bool) {
    let hwnd = hwnd();
    let saved = sys::save_clipboard(hwnd);
    let seq = sys::clipboard_seq();
    sys::tap_combo(VK_LCONTROL, VK_INSERT); // копировать (в терминалах безопаснее, чем Ctrl+C)
    let mut text = None;
    for _ in 0..50 {
        sleep(Duration::from_millis(10));
        if sys::clipboard_seq() != seq {
            sleep(Duration::from_millis(20));
            text = sys::clipboard_text(hwnd);
            break;
        }
    }
    let word_len = last_word_len();
    let text = text.filter(|t| !t.is_empty() && !(word_len > 0 && looks_like_line_copy(t)));

    let Some(text) = text else {
        if sys::clipboard_seq() != seq {
            sys::restore_clipboard(hwnd, saved);
        }
        if !allow_fallback {
            return;
        }
        // Ничего не выделено: работаем с последним набранным словом.
        if action == Action::ConvertSelection {
            convert_buffer(false);
        } else if word_len > 0 {
            sys::select_left(word_len);
            sleep(Duration::from_millis(30));
            selection_action(action, false);
        }
        return;
    };

    if let Some((out, layout)) = transform(action, &text)
        && out != text
    {
        sys::set_clipboard_text(hwnd, &out);
        sys::tap_combo(VK_LSHIFT, VK_INSERT); // вставить
        if let Some(h) = layout {
            sys::activate_layout(h);
        }
        // Оставить результат выделенным, чтобы горячую клавишу можно было нажать ещё раз.
        let n = out.chars().filter(|&c| c != '\r').count();
        if n <= 3000 {
            sys::select_left(n);
        }
        hook::clear_buffer();
    }
    sleep(Duration::from_millis(350));
    sys::restore_clipboard(hwnd, saved);
}

fn do_action(action: Action) {
    sys::release_modifiers();
    match action {
        Action::ConvertWord => convert_buffer(false),
        Action::ConvertPhrase => convert_buffer(true),
        _ => selection_action(action, true),
    }
}

// =============================================================================================
// Иконка в трее
// =============================================================================================

fn lang_label(hkl: isize) -> String {
    let langid = (hkl as usize & 0xFFFF) as u32;
    match langid & 0x3FF {
        0x09 => return "АНГ".into(),
        0x22 => return "УКР".into(),
        0x19 => return "РУС".into(),
        0x23 => return "БЕЛ".into(),
        0x07 => return "НЕМ".into(),
        0x15 => return "ПОЛ".into(),
        0x0C => return "ФРА".into(),
        0x0A => return "ИСП".into(),
        0x10 => return "ИТА".into(),
        0x3F => return "КАЗ".into(),
        _ => {}
    }
    let mut buf = [0u16; 16];
    let n = unsafe { GetLocaleInfoW(langid, 0x59 /* LOCALE_SISO639LANGNAME */, buf.as_mut_ptr(), buf.len() as i32) };
    if n > 1 {
        String::from_utf16_lossy(&buf[..(n - 1) as usize]).to_uppercase().chars().take(3).collect()
    } else {
        "??".into()
    }
}

const fn rgb(r: u8, g: u8, b: u8) -> u32 {
    r as u32 | (g as u32) << 8 | (b as u32) << 16
}

fn make_icon(label: &str, bg: u32, fg: u32, auto_bar: bool) -> HICON {
    unsafe {
        let size = GetSystemMetrics(SM_CXSMICON).max(16);
        let screen = GetDC(null_mut());
        let dc = CreateCompatibleDC(screen);
        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        bi.bmiHeader.biWidth = size;
        bi.bmiHeader.biHeight = -size;
        bi.bmiHeader.biPlanes = 1;
        bi.bmiHeader.biBitCount = 32;
        let mut bits: *mut core::ffi::c_void = null_mut();
        let color = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        let old = SelectObject(dc, color);

        let rect = RECT { left: 0, top: 0, right: size, bottom: size };
        let brush = CreateSolidBrush(bg);
        FillRect(dc, &rect, brush);
        DeleteObject(brush);
        if auto_bar {
            // Зелёная полоска внизу = исправление на лету включено.
            let h = (size / 8).max(2);
            let bar = RECT { left: 0, top: size - h, right: size, bottom: size };
            let brush = CreateSolidBrush(rgb(40, 200, 90));
            FillRect(dc, &bar, brush);
            DeleteObject(brush);
        }

        let face = wide("Segoe UI");
        // Три буквы (УКР, РУС, АНГ) — узким шрифтом, чтобы поместились в маленькую иконку.
        let three = label.chars().count() > 2;
        let height = if three { size * 9 / 16 } else { size * 11 / 16 };
        let width = if three { size / 4 } else { 0 };
        let font = CreateFontW(-height, width, 0, 0, FW_BOLD as i32, 0, 0, 0, DEFAULT_CHARSET as u32, OUT_DEFAULT_PRECIS as u32, CLIP_DEFAULT_PRECIS as u32, ANTIALIASED_QUALITY as u32, 0, face.as_ptr());
        let old_font = SelectObject(dc, font);
        SetBkMode(dc, TRANSPARENT as _);
        SetTextColor(dc, fg);
        let mut text = wide(label);
        let mut r = rect;
        DrawTextW(dc, text.as_mut_ptr(), -1, &mut r, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        GdiFlush();

        // Непрозрачно везде, кроме слегка скруглённых углов.
        let px = std::slice::from_raw_parts_mut(bits as *mut u32, (size * size) as usize);
        let s = size as usize;
        for y in 0..s {
            for x in 0..s {
                let corner = (x == 0 || x == s - 1) && (y == 0 || y == s - 1);
                px[y * s + x] = if corner { 0 } else { px[y * s + x] | 0xFF00_0000 };
            }
        }

        SelectObject(dc, old_font);
        DeleteObject(font);
        SelectObject(dc, old);
        let mask = CreateBitmap(size, size, 1, 1, null());
        let info = ICONINFO { fIcon: 1, xHotspot: 0, yHotspot: 0, hbmMask: mask, hbmColor: color };
        let icon = CreateIconIndirect(&info);
        DeleteObject(mask);
        DeleteObject(color);
        DeleteDC(dc);
        ReleaseDC(null_mut(), screen);
        icon
    }
}

fn icon_for(hkl: isize, enabled: bool, auto_on: bool) -> HICON {
    let key = ((hkl as usize & 0xFFFF) as u16, enabled, auto_on);
    if let Some(i) = APP.with(|a| a.borrow().icons.get(&key).copied()) {
        return i;
    }
    let label = lang_label(hkl);
    let (bg, fg) = if !enabled {
        (rgb(150, 150, 150), rgb(240, 240, 240))
    } else {
        match label.as_str() {
            "АНГ" => (rgb(32, 96, 160), rgb(255, 255, 255)),
            "УКР" => (rgb(0, 87, 183), rgb(255, 213, 0)),
            "РУС" => (rgb(170, 40, 40), rgb(255, 255, 255)),
            _ => (rgb(70, 70, 70), rgb(255, 255, 255)),
        }
    };
    let icon = make_icon(&label, bg, fg, auto_on && enabled);
    APP.with(|a| a.borrow_mut().icons.insert(key, icon));
    icon
}

fn copy_wstr(dst: &mut [u16], s: &str) {
    let w: Vec<u16> = s.encode_utf16().take(dst.len() - 1).collect();
    dst[..w.len()].copy_from_slice(&w);
    dst[w.len()] = 0;
}

fn auto_on() -> bool {
    hook::AUTO_MODE.load(Ordering::Relaxed) != AUTO_OFF
}

fn tray_data(hkl: isize, enabled: bool) -> NOTIFYICONDATAW {
    let mut nid: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    nid.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
    nid.hWnd = hwnd();
    nid.uID = 1;
    nid.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP;
    nid.uCallbackMessage = WM_APP_TRAY;
    nid.hIcon = icon_for(hkl, enabled, auto_on());
    let state = if !enabled {
        " (выключено)"
    } else if auto_on() {
        ", исправление на лету"
    } else {
        ""
    };
    let tip = format!("{APP_TITLE} — {}{state}", lang_label(hkl));
    copy_wstr(&mut nid.szTip, &tip);
    nid
}

fn update_tray(add: bool) {
    let (_, hkl) = hook::foreground_layout();
    let hkl = if hkl == 0 { APP.with(|a| a.borrow().shown.0) } else { hkl };
    let enabled = hook::ENABLED.load(Ordering::Relaxed);
    let nid = tray_data(hkl, enabled);
    let ok = unsafe { Shell_NotifyIconW(if add { NIM_ADD } else { NIM_MODIFY }, &nid) } != 0;
    APP.with(|a| {
        let mut a = a.borrow_mut();
        a.shown = (hkl, enabled, auto_on());
        if add {
            a.tray_added = ok;
        }
    });
}

fn balloon(title: &str, text: &str) {
    let (hkl, enabled, _) = APP.with(|a| a.borrow().shown);
    let mut nid = tray_data(hkl, enabled);
    nid.uFlags = NIF_INFO;
    nid.dwInfoFlags = NIIF_INFO;
    copy_wstr(&mut nid.szInfoTitle, title);
    copy_wstr(&mut nid.szInfo, text);
    unsafe {
        Shell_NotifyIconW(NIM_MODIFY, &nid);
    }
}

fn on_timer() {
    // При входе в систему Проводник может быть ещё не готов: пробуем добавить иконку снова.
    if !APP.with(|a| a.borrow().tray_added) {
        update_tray(true);
    }
    layouts::refresh(&sys::installed_layouts());
    hook::AUTO_PREF.store(if prefer_uk() { 0x22 } else { 0x19 }, Ordering::Relaxed);
    let (fg, hkl) = hook::foreground_layout();
    if fg == 0 || fg == hwnd() as isize || hkl == 0 {
        return;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(fg as HWND, &mut pid) };
    let app = sys::process_name(pid).filter(|n| n != "explorer.exe" && n != "rozkladka.exe");
    let enabled = hook::ENABLED.load(Ordering::Relaxed);
    let changed = APP.with(|a| {
        let mut a = a.borrow_mut();
        a.last_used.insert(hkl, unsafe { GetTickCount() });
        if app.is_some() {
            a.last_app = app;
        }
        a.shown != (hkl, enabled, auto_on())
    });
    if changed {
        update_tray(false);
    }
}

fn set_enabled(on: bool) {
    hook::ENABLED.store(on, Ordering::Relaxed);
    hook::clear_buffer();
    sys::reg_set_dword("Enabled", on as u32);
    update_tray(false);
}

fn show_menu() {
    let hwnd = hwnd();
    unsafe {
        let menu = CreatePopupMenu();
        let check = |on: bool| if on { MF_CHECKED } else { MF_UNCHECKED };
        let items: [(usize, String, u32); 3] = [
            (ID_ENABLED, "Включено".into(), check(hook::ENABLED.load(Ordering::Relaxed))),
            (ID_DOUBLE_SHIFT, "Двойной Shift = исправить слово".into(), check(hook::DOUBLE_SHIFT.load(Ordering::Relaxed))),
            (ID_AUTOSTART, "Автозапуск с Windows".into(), check(sys::autostart_enabled())),
        ];
        let mode = hook::AUTO_MODE.load(Ordering::Relaxed);
        let auto_menu = CreatePopupMenu();
        let add = |m: HMENU, id: usize, text: &str, checked: bool| {
            let w = wide(text);
            AppendMenuW(m, MF_STRING | check(checked), id, w.as_ptr());
        };
        add(auto_menu, ID_AUTO_OFF, "Выключено", mode == AUTO_OFF);
        add(auto_menu, ID_AUTO_ALL, "Между всеми языками (англ. ↔ укр. ↔ рус.)", mode == AUTO_ALL);
        AppendMenuW(auto_menu, MF_SEPARATOR, 0, null());
        // Все три языка доступны всегда: если раскладка не установлена, слово просто
        // перепечатывается нужными буквами (без переключения раскладки).
        let installed: Vec<u16> = sys::installed_layouts().into_iter().map(primary_lang).collect();
        for (p, name) in [(0x22u16, "Всё на украинский"), (0x19, "Всё на русский"), (0x09, "Всё на английский")] {
            let text = if installed.contains(&p) { name.to_string() } else { format!("{name} (раскладка не установлена)") };
            add(auto_menu, ID_AUTO_TARGET + p as usize, &text, mode == 0x100 | p as u32);
        }

        let (id, text, flags) = &items[0];
        add(menu, *id, text, *flags == MF_CHECKED);
        let w = wide("Исправлять на лету");
        AppendMenuW(menu, MF_POPUP | if mode != AUTO_OFF { MF_CHECKED } else { MF_UNCHECKED }, auto_menu as usize, w.as_ptr());
        let last_app = APP.with(|a| a.borrow().last_app.clone());
        if let Some(app) = &last_app {
            let excluded = hook::EXCLUDED_APPS.read().map(|l| l.contains(app)).unwrap_or(false);
            add(menu, ID_EXCLUDE_APP, &format!("Не исправлять на лету в «{app}»"), excluded);
        }
        AppendMenuW(menu, MF_SEPARATOR, 0, null());
        for (id, text, flags) in items.iter().skip(1) {
            add(menu, *id, text, *flags == MF_CHECKED);
        }
        AppendMenuW(menu, MF_SEPARATOR, 0, null());
        let w = wide("Горячие клавиши…");
        AppendMenuW(menu, MF_STRING, ID_HELP, w.as_ptr());
        AppendMenuW(menu, MF_SEPARATOR, 0, null());
        let w = wide("Выход");
        AppendMenuW(menu, MF_STRING, ID_EXIT, w.as_ptr());

        let mut pt = POINT { x: 0, y: 0 };
        GetCursorPos(&mut pt);
        SetForegroundWindow(hwnd);
        let cmd = TrackPopupMenu(menu, TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_BOTTOMALIGN, pt.x, pt.y, 0, hwnd, null());
        PostMessageW(hwnd, WM_NULL, 0, 0);
        DestroyMenu(menu); // заодно уничтожает подменю

        let cmd = cmd as usize;
        if cmd == ID_AUTO_OFF || cmd == ID_AUTO_ALL || cmd > ID_AUTO_TARGET {
            let mode = match cmd {
                ID_AUTO_OFF => AUTO_OFF,
                ID_AUTO_ALL => AUTO_ALL,
                _ => 0x100 | (cmd - ID_AUTO_TARGET) as u32,
            };
            hook::AUTO_MODE.store(mode, Ordering::Relaxed);
            sys::reg_set_dword("AutoMode", mode);
            update_tray(false);
            return;
        }
        if cmd == ID_EXCLUDE_APP {
            if let Some(app) = last_app
                && let Ok(mut l) = hook::EXCLUDED_APPS.write()
            {
                if let Some(i) = l.iter().position(|a| *a == app) {
                    l.remove(i);
                } else {
                    l.push(app);
                }
                sys::reg_set_string("ExcludedApps", &l.join("|"));
                hook::EXCLUDED_GEN.fetch_add(1, Ordering::Relaxed);
            }
            return;
        }
        match cmd {
            ID_ENABLED => set_enabled(!hook::ENABLED.load(Ordering::Relaxed)),
            ID_DOUBLE_SHIFT => {
                let on = !hook::DOUBLE_SHIFT.load(Ordering::Relaxed);
                hook::DOUBLE_SHIFT.store(on, Ordering::Relaxed);
                sys::reg_set_dword("DoubleShift", on as u32);
            }
            ID_AUTOSTART => sys::set_autostart(!sys::autostart_enabled()),
            ID_HELP => sys::message_box(HELP, APP_TITLE, MB_OK | MB_ICONINFORMATION),
            ID_EXIT => {
                DestroyWindow(hwnd);
            }
            _ => {}
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        match msg {
            WM_APP_ACTION => {
                if hook::ENABLED.load(Ordering::Relaxed)
                    && let Some(a) = Action::from_usize(wparam)
                {
                    do_action(a);
                }
                0
            }
            WM_APP_TRAY => {
                match lparam as u32 {
                    WM_RBUTTONUP | WM_CONTEXTMENU => show_menu(),
                    WM_LBUTTONDBLCLK => set_enabled(!hook::ENABLED.load(Ordering::Relaxed)),
                    _ => {}
                }
                0
            }
            WM_TIMER => {
                on_timer();
                0
            }
            WM_DESTROY => {
                let nid = tray_data(0, true);
                Shell_NotifyIconW(NIM_DELETE, &nid);
                PostQuitMessage(0);
                0
            }
            _ => {
                if msg != 0 && msg == APP.with(|a| a.borrow().taskbar_created) {
                    update_tray(true); // Проводник перезапустился
                    return 0;
                }
                DefWindowProcW(hwnd, msg, wparam, lparam)
            }
        }
    }
}

pub fn run() {
    unsafe {
        SetProcessDPIAware();

        let mutex_name = wide("Local\\Rozkladka-single-instance");
        let _mutex = CreateMutexW(null(), 0, mutex_name.as_ptr());
        if GetLastError() == ERROR_ALREADY_EXISTS {
            sys::message_box("Раскладка уже запущена — иконка в трее (возле часов).", APP_TITLE, MB_OK | MB_ICONINFORMATION);
            return;
        }

        // Настройки
        hook::ENABLED.store(sys::reg_get_dword("Enabled").unwrap_or(1) != 0, Ordering::Relaxed);
        hook::DOUBLE_SHIFT.store(sys::reg_get_dword("DoubleShift").unwrap_or(1) != 0, Ordering::Relaxed);
        hook::AUTO_MODE.store(sys::reg_get_dword("AutoMode").unwrap_or(AUTO_ALL), Ordering::Relaxed);
        if let Ok(mut l) = hook::EXCLUDED_APPS.write() {
            *l = sys::reg_get_string("ExcludedApps")
                .unwrap_or_default()
                .split('|')
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
        }
        if let Ok(mut ex) = hook::EXCEPTIONS.lock() {
            *ex = Some(sys::load_exceptions());
        }
        layouts::refresh(&sys::installed_layouts());
        let first_run = sys::reg_get_dword("Initialized").is_none();
        if first_run {
            sys::set_autostart(true);
            sys::reg_set_dword("Initialized", 1);
        } else {
            sys::refresh_autostart_path();
        }

        let hinst = GetModuleHandleW(null());
        let class = wide("RozkladkaWindow");
        let wc = WNDCLASSW {
            style: 0,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinst,
            hIcon: null_mut(),
            hCursor: null_mut(),
            hbrBackground: null_mut(),
            lpszMenuName: null(),
            lpszClassName: class.as_ptr(),
        };
        RegisterClassW(&wc);
        let title = wide(APP_TITLE);
        let hwnd = CreateWindowExW(0, class.as_ptr(), title.as_ptr(), 0, 0, 0, 0, 0, null_mut(), null_mut(), hinst, null());
        if hwnd.is_null() {
            return;
        }
        let tc = wide("TaskbarCreated");
        let taskbar_created = RegisterWindowMessageW(tc.as_ptr());
        APP.with(|a| {
            let mut a = a.borrow_mut();
            a.hwnd = hwnd;
            a.taskbar_created = taskbar_created;
        });

        update_tray(true);
        hook::start(hwnd);
        SetTimer(hwnd, TIMER_ID, 250, None);

        if first_run {
            balloon(
                "Раскладка запущена",
                "Слова в неправильной раскладке исправляются сами после пробела.\nPause — исправить/отменить. Правый клик по иконке — настройки и целевой язык.",
            );
        }

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
