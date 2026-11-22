//! Thin wrappers over Win32: keyboard input injection, clipboard, registry.

use std::ptr::null_mut;
use std::thread::sleep;
use std::time::Duration;

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::DataExchange::*;
use windows_sys::Win32::System::Memory::*;
use windows_sys::Win32::System::Registry::*;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// ---------------------------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------------------------

fn is_extended(vk: u16) -> bool {
    matches!(
        vk,
        VK_LEFT | VK_RIGHT | VK_UP | VK_DOWN | VK_INSERT | VK_DELETE | VK_HOME | VK_END | VK_PRIOR | VK_NEXT
            | VK_RCONTROL | VK_RMENU | VK_LWIN | VK_RWIN
    )
}

fn vk_input(vk: u16, up: bool) -> INPUT {
    let mut flags = if up { KEYEVENTF_KEYUP } else { 0 };
    if is_extended(vk) {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    let scan = unsafe { MapVirtualKeyW(vk as u32, MAPVK_VK_TO_VSC) } as u16;
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn unicode_input(unit: u16, up: bool) -> INPUT {
    let flags = KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: 0, wScan: unit, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
    }
}

fn send(inputs: &[INPUT]) {
    for chunk in inputs.chunks(200) {
        unsafe {
            SendInput(chunk.len() as u32, chunk.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
    }
}

pub fn pressed(vk: u16) -> bool {
    unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
}

/// Make sure no modifier key is held before we start typing / copying.
pub fn release_modifiers() {
    // If Alt or Win is held, a "neutral" key press prevents the menu bar / Start menu
    // from popping up when the user releases it (we swallowed the Pause key).
    if pressed(VK_MENU) || pressed(VK_LWIN) || pressed(VK_RWIN) {
        send(&[vk_input(0xE8, false), vk_input(0xE8, true)]);
    }
    const MODS: [u16; 8] = [VK_LSHIFT, VK_RSHIFT, VK_LCONTROL, VK_RCONTROL, VK_LMENU, VK_RMENU, VK_LWIN, VK_RWIN];
    for _ in 0..100 {
        if !MODS.iter().any(|&m| pressed(m)) {
            return;
        }
        sleep(Duration::from_millis(10));
    }
    let ups: Vec<INPUT> = MODS.iter().filter(|&&m| pressed(m)).map(|&m| vk_input(m, true)).collect();
    send(&ups);
}

pub fn tap_combo(modifier: u16, vk: u16) {
    send(&[vk_input(modifier, false), vk_input(vk, false), vk_input(vk, true), vk_input(modifier, true)]);
}

pub fn backspaces(n: usize) {
    let mut v = Vec::with_capacity(n * 2);
    for _ in 0..n {
        v.push(vk_input(VK_BACK, false));
        v.push(vk_input(VK_BACK, true));
    }
    send(&v);
}

/// Select `n` characters to the left of the caret.
pub fn select_left(n: usize) {
    let mut v = Vec::with_capacity(n * 2 + 2);
    v.push(vk_input(VK_LSHIFT, false));
    for _ in 0..n {
        v.push(vk_input(VK_LEFT, false));
        v.push(vk_input(VK_LEFT, true));
    }
    v.push(vk_input(VK_LSHIFT, true));
    send(&v);
}

pub fn type_text(s: &str) {
    let mut v = Vec::with_capacity(s.len() * 2);
    for c in s.chars() {
        match c {
            '\r' => {}
            '\n' => {
                v.push(vk_input(VK_RETURN, false));
                v.push(vk_input(VK_RETURN, true));
            }
            '\t' => {
                v.push(vk_input(VK_TAB, false));
                v.push(vk_input(VK_TAB, true));
            }
            _ => {
                let mut buf = [0u16; 2];
                for &u in c.encode_utf16(&mut buf).iter() {
                    v.push(unicode_input(u, false));
                    v.push(unicode_input(u, true));
                }
            }
        }
    }
    send(&v);
}

/// Ask the foreground window to switch to keyboard layout `hkl`.
pub fn activate_layout(hkl: isize) {
    unsafe {
        let fg = GetForegroundWindow();
        if !fg.is_null() {
            PostMessageW(fg, WM_INPUTLANGCHANGEREQUEST, 0, hkl);
        }
    }
}

pub fn installed_layouts() -> Vec<isize> {
    unsafe {
        let n = GetKeyboardLayoutList(0, null_mut());
        if n <= 0 {
            return Vec::new();
        }
        let mut v = vec![null_mut(); n as usize];
        let n = GetKeyboardLayoutList(n, v.as_mut_ptr());
        v.truncate(n.max(0) as usize);
        v.into_iter().map(|h| h as isize).collect()
    }
}

// ---------------------------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------------------------

const CF_UNICODETEXT: u32 = 13;

fn open_clipboard(hwnd: HWND) -> bool {
    for _ in 0..20 {
        if unsafe { OpenClipboard(hwnd) } != 0 {
            return true;
        }
        sleep(Duration::from_millis(10));
    }
    false
}

/// Saved clipboard contents (all memory-based formats).
pub struct SavedClipboard(Vec<(u32, Vec<u8>)>);

fn restorable_format(f: u32) -> bool {
    // GDI-handle based / owner-drawn / private formats can't be copied as plain memory.
    !matches!(f, 2 | 3 | 9 | 14 | 0x80 | 0x82 | 0x83 | 0x8E | 0x200..=0x3FF)
}

pub fn save_clipboard(hwnd: HWND) -> SavedClipboard {
    let mut out = Vec::new();
    if !open_clipboard(hwnd) {
        return SavedClipboard(out);
    }
    unsafe {
        let mut total = 0usize;
        let mut fmt = 0u32;
        loop {
            fmt = EnumClipboardFormats(fmt);
            if fmt == 0 {
                break;
            }
            if !restorable_format(fmt) {
                continue;
            }
            let h = GetClipboardData(fmt);
            if h.is_null() {
                continue;
            }
            let size = GlobalSize(h as HGLOBAL);
            let p = GlobalLock(h as HGLOBAL) as *const u8;
            if p.is_null() {
                continue;
            }
            let data = std::slice::from_raw_parts(p, size).to_vec();
            GlobalUnlock(h as HGLOBAL);
            total += size;
            out.push((fmt, data));
            if total > 64 << 20 {
                break;
            }
        }
        CloseClipboard();
    }
    SavedClipboard(out)
}

unsafe fn put_bytes(fmt: u32, bytes: &[u8]) {
    unsafe {
        let h = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        if h.is_null() {
            return;
        }
        let p = GlobalLock(h) as *mut u8;
        if p.is_null() {
            GlobalFree(h);
            return;
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), p, bytes.len());
        GlobalUnlock(h);
        if SetClipboardData(fmt, h as HANDLE).is_null() {
            GlobalFree(h);
        }
    }
}

pub fn restore_clipboard(hwnd: HWND, saved: SavedClipboard) {
    if !open_clipboard(hwnd) {
        return;
    }
    unsafe {
        EmptyClipboard();
        for (fmt, data) in &saved.0 {
            put_bytes(*fmt, data);
        }
        CloseClipboard();
    }
}

pub fn clipboard_text(hwnd: HWND) -> Option<String> {
    if !open_clipboard(hwnd) {
        return None;
    }
    unsafe {
        let mut res = None;
        let h = GetClipboardData(CF_UNICODETEXT);
        if !h.is_null() {
            let p = GlobalLock(h as HGLOBAL) as *const u16;
            if !p.is_null() {
                let max = GlobalSize(h as HGLOBAL) / 2;
                let mut len = 0;
                while len < max && *p.add(len) != 0 {
                    len += 1;
                }
                res = Some(String::from_utf16_lossy(std::slice::from_raw_parts(p, len)));
                GlobalUnlock(h as HGLOBAL);
            }
        }
        CloseClipboard();
        res
    }
}

pub fn set_clipboard_text(hwnd: HWND, text: &str) {
    if !open_clipboard(hwnd) {
        return;
    }
    unsafe {
        EmptyClipboard();
        let w = wide(text);
        let bytes = std::slice::from_raw_parts(w.as_ptr() as *const u8, w.len() * 2);
        put_bytes(CF_UNICODETEXT, bytes);
        // Keep our temporary text out of Win+V clipboard history and cloud sync.
        let name = wide("ExcludeClipboardContentFromMonitorProcessing");
        let f = RegisterClipboardFormatW(name.as_ptr());
        if f != 0 {
            put_bytes(f, &[0, 0, 0, 0]);
        }
        CloseClipboard();
    }
}

pub fn clipboard_seq() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

// ---------------------------------------------------------------------------------------------
// Registry (settings + autostart)
// ---------------------------------------------------------------------------------------------

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const APP_KEY: &str = r"Software\Rozkladka";
const APP_NAME: &str = "Rozkladka";

pub fn reg_get_dword(name: &str) -> Option<u32> {
    let (k, n) = (wide(APP_KEY), wide(name));
    let mut val = 0u32;
    let mut size = 4u32;
    let r = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_DWORD, null_mut(), &mut val as *mut u32 as _, &mut size)
    };
    (r == ERROR_SUCCESS).then_some(val)
}

pub fn reg_set_dword(name: &str, val: u32) {
    let (k, n) = (wide(APP_KEY), wide(name));
    unsafe {
        RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), REG_DWORD, &val as *const u32 as _, 4);
    }
}

fn exe_path() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

fn autostart_value() -> Option<String> {
    let (k, n) = (wide(RUN_KEY), wide(APP_NAME));
    let mut buf = vec![0u16; 1024];
    let mut size = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, null_mut(), buf.as_mut_ptr() as _, &mut size)
    };
    if r != ERROR_SUCCESS {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

pub fn autostart_enabled() -> bool {
    autostart_value().is_some()
}

pub fn set_autostart(on: bool) {
    let (k, n) = (wide(RUN_KEY), wide(APP_NAME));
    unsafe {
        if on {
            let v = wide(&format!("\"{}\"", exe_path()));
            RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), REG_SZ, v.as_ptr() as _, (v.len() * 2) as u32);
        } else {
            RegDeleteKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr());
        }
    }
}

/// If autostart is on but the exe was moved, point the Run entry to the new location.
pub fn refresh_autostart_path() {
    if let Some(v) = autostart_value()
        && v.trim_matches('"') != exe_path()
    {
        set_autostart(true);
    }
}

pub fn reg_get_string(name: &str) -> Option<String> {
    let (k, n) = (wide(APP_KEY), wide(name));
    let mut buf = vec![0u16; 8192];
    let mut size = (buf.len() * 2) as u32;
    let r = unsafe {
        RegGetValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), RRF_RT_REG_SZ, null_mut(), buf.as_mut_ptr() as _, &mut size)
    };
    if r != ERROR_SUCCESS {
        return None;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    Some(String::from_utf16_lossy(&buf[..len]))
}

pub fn reg_set_string(name: &str, val: &str) {
    let (k, n, v) = (wide(APP_KEY), wide(name), wide(val));
    unsafe {
        RegSetKeyValueW(HKEY_CURRENT_USER, k.as_ptr(), n.as_ptr(), REG_SZ, v.as_ptr() as _, (v.len() * 2) as u32);
    }
}

/// Lower-case exe file name of a process, e.g. "chrome.exe".
pub fn process_name(pid: u32) -> Option<String> {
    use windows_sys::Win32::System::Threading::*;
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, buf.as_mut_ptr(), &mut len) != 0;
        CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        path.rsplit(['\\', '/']).next().map(|s| s.to_lowercase())
    }
}

/// %APPDATA%\Rozkladka\exceptions.txt — words that must not be corrected automatically.
fn exceptions_path() -> Option<std::path::PathBuf> {
    std::env::var_os("APPDATA").map(|d| std::path::Path::new(&d).join("Rozkladka").join("exceptions.txt"))
}

pub fn load_exceptions() -> std::collections::HashSet<String> {
    exceptions_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect())
        .unwrap_or_default()
}

pub fn add_exception(word: &str) {
    use std::io::Write;
    let Some(p) = exceptions_path() else { return };
    if let Some(dir) = p.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(p) {
        let _ = writeln!(f, "{word}");
    }
}

pub fn message_box(text: &str, title: &str, flags: MESSAGEBOX_STYLE) {
    let (t, c) = (wide(text), wide(title));
    unsafe {
        MessageBoxW(null_mut(), t.as_ptr(), c.as_ptr(), flags);
    }
}
