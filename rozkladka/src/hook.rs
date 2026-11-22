//! Low-level keyboard / mouse hooks running on their own thread.
//!
//! The hook only records keystrokes (scan code + Shift/CapsLock + layout) and
//! detects hotkeys; the actual work is posted to the main window so the hook
//! callback stays fast.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Mutex, RwLock};

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::SystemInformation::GetTickCount;
use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::auto::{self, Lang};
use crate::keymap::{SCAN_SPACE, is_char_scan};
use crate::layouts::LAYOUTS;
use crate::sys;

pub const WM_APP_ACTION: u32 = WM_APP + 1;
const MAX_KEYS: usize = 300;
const DOUBLE_SHIFT_MS: u32 = 400;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Action {
    ConvertWord = 1,
    ConvertPhrase,
    ConvertSelection,
    InvertCase,
    CycleCase,
    Translit,
}

impl Action {
    pub fn from_usize(v: usize) -> Option<Action> {
        use Action::*;
        [ConvertWord, ConvertPhrase, ConvertSelection, InvertCase, CycleCase, Translit]
            .into_iter()
            .find(|a| *a as usize == v)
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Key {
    pub scan: u16,
    pub shift: bool,
    pub caps: bool,
    /// Keyboard layout (HKL) that was active when the key was pressed.
    pub hkl: isize,
}

impl Key {
    pub fn is_space(&self) -> bool {
        self.scan == SCAN_SPACE
    }
}

pub struct Buffer {
    pub keys: Vec<Key>,
    /// Incremented every time the user changes the buffer (used to detect repeated hotkey presses).
    pub version: u64,
    last_hwnd: isize,
    caps: bool,
    caps_held: bool,
    shift_held: bool,
    shift_clean: bool,
    last_shift_tap: u32,
    pause_swallowed: bool,
    /// Layout we just asked the foreground window to switch to (it may not have switched yet).
    pending: Option<(isize, u32)>,
    /// The last automatic correction, so that Pause can undo it.
    pub undo: Option<AutoUndo>,
}

pub struct AutoUndo {
    /// Buffer version right after the correction (any further typing invalidates the undo).
    pub version: u64,
    /// Corrected keys are `keys[start..end]`, followed by the space at `end`.
    pub start: usize,
    pub end: usize,
    pub from: isize,
    /// The word as originally typed (normalized) — added to the exceptions on undo.
    pub word: String,
}

impl Buffer {
    /// Remember that we requested a layout switch (keys typed right after still use `hkl`).
    pub fn set_pending(&mut self, hkl: isize) {
        self.pending = Some((hkl, unsafe { GetTickCount() }));
    }

    fn clear(&mut self) {
        if !self.keys.is_empty() {
            self.keys.clear();
        }
        self.version += 1;
    }
}

pub static BUF: Mutex<Buffer> = Mutex::new(Buffer {
    keys: Vec::new(),
    version: 0,
    last_hwnd: 0,
    caps: false,
    caps_held: false,
    shift_held: false,
    shift_clean: false,
    last_shift_tap: 0,
    pause_swallowed: false,
    pending: None,
    undo: None,
});

pub static ENABLED: AtomicBool = AtomicBool::new(true);
pub static DOUBLE_SHIFT: AtomicBool = AtomicBool::new(true);
/// On-the-fly correction: 0 = off, 1 = between all languages, 0x100 | primary LANGID = into one language.
pub static AUTO_MODE: AtomicU32 = AtomicU32::new(1);
/// Preferred Cyrillic language (primary LANGID) when Ukrainian and Russian both fit.
pub static AUTO_PREF: AtomicU32 = AtomicU32::new(0x22);
/// Words the user rejected (undid with Pause) — never corrected automatically again.
pub static EXCEPTIONS: Mutex<Option<HashSet<String>>> = Mutex::new(None);
/// Programs (lower-case exe names) where on-the-fly correction is disabled.
pub static EXCLUDED_APPS: RwLock<Vec<String>> = RwLock::new(Vec::new());
pub static EXCLUDED_GEN: AtomicU32 = AtomicU32::new(0);

pub const AUTO_OFF: u32 = 0;
pub const AUTO_ALL: u32 = 1;
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn clear_buffer() {
    if let Ok(mut b) = BUF.lock() {
        b.clear();
    }
}

fn pressed(vk: u16) -> bool {
    unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
}

fn post(action: Action) {
    let hwnd = MAIN_HWND.load(Ordering::Relaxed);
    unsafe {
        PostMessageW(hwnd as HWND, WM_APP_ACTION, action as usize, 0);
    }
}

pub fn foreground_layout() -> (isize, isize) {
    unsafe {
        let fg = GetForegroundWindow();
        let tid = GetWindowThreadProcessId(fg, std::ptr::null_mut());
        (fg as isize, GetKeyboardLayout(tid) as isize)
    }
}

/// Returns true if the key event must be swallowed.
fn on_key(k: &KBDLLHOOKSTRUCT, down: bool) -> bool {
    let vk = k.vkCode as u16;
    let Ok(mut b) = BUF.lock() else { return false };

    // ---- hotkeys on Pause / Break --------------------------------------------------------
    if vk == VK_PAUSE || vk == VK_CANCEL {
        b.shift_clean = false;
        b.last_shift_tap = 0;
        if !down {
            let swallow = b.pause_swallowed;
            b.pause_swallowed = false;
            return swallow;
        }
        let (ctrl, shift, alt) = (pressed(VK_CONTROL), pressed(VK_SHIFT), pressed(VK_MENU));
        let win = pressed(VK_LWIN) || pressed(VK_RWIN);
        let action = match (ctrl, shift, alt, win) {
            (false, false, false, false) => Action::ConvertWord,
            (true, false, false, false) => Action::ConvertPhrase,
            (false, true, false, false) => Action::ConvertSelection,
            (false, false, true, false) => Action::InvertCase,
            (false, true, true, false) => Action::CycleCase,
            (true, true, false, false) => Action::Translit,
            _ => return false,
        };
        b.pause_swallowed = true;
        drop(b);
        post(action);
        return true;
    }

    // ---- modifiers -----------------------------------------------------------------------
    match vk {
        VK_SHIFT | VK_LSHIFT | VK_RSHIFT => {
            if down {
                if !b.shift_held {
                    b.shift_held = true;
                    b.shift_clean = true;
                }
            } else {
                b.shift_held = false;
                if b.shift_clean && DOUBLE_SHIFT.load(Ordering::Relaxed) {
                    let t = k.time;
                    if b.last_shift_tap != 0 && t.wrapping_sub(b.last_shift_tap) < DOUBLE_SHIFT_MS {
                        b.last_shift_tap = 0;
                        drop(b);
                        post(Action::ConvertWord);
                        return false;
                    }
                    b.last_shift_tap = t.max(1);
                }
                b.shift_clean = false;
            }
            return false;
        }
        VK_CAPITAL => {
            // Auto-repeat while CapsLock is held must not toggle it again.
            if down && !b.caps_held {
                b.caps = !b.caps;
            }
            b.caps_held = down;
            b.shift_clean = false;
            b.last_shift_tap = 0;
            return false;
        }
        VK_CONTROL | VK_LCONTROL | VK_RCONTROL | VK_MENU | VK_LMENU | VK_RMENU | VK_LWIN | VK_RWIN => {
            b.shift_clean = false;
            b.last_shift_tap = 0;
            return false;
        }
        _ => {}
    }

    if !down {
        return false;
    }
    b.shift_clean = false;
    b.last_shift_tap = 0;

    // ---- regular keys: remember what was typed --------------------------------------------
    let (fg, hkl) = foreground_layout();
    if fg != b.last_hwnd {
        b.clear();
        b.last_hwnd = fg;
    }
    if pressed(VK_CONTROL) || pressed(VK_MENU) || pressed(VK_LWIN) || pressed(VK_RWIN) {
        b.clear();
        return false;
    }
    let hkl = match b.pending {
        Some((p, t)) if p != hkl && unsafe { GetTickCount() }.wrapping_sub(t) < 1500 => p,
        Some(_) => {
            b.pending = None;
            hkl
        }
        None => hkl,
    };
    let scan = k.scanCode as u16;
    let extended = k.flags & LLKHF_EXTENDED != 0;
    if scan == SCAN_SPACE && !extended && try_autocorrect(&mut b) {
        return true; // the space is retyped by the correction
    }
    if vk == VK_BACK {
        b.keys.pop();
        b.version += 1;
    } else if !extended && (is_char_scan(scan) || scan == SCAN_SPACE) {
        let key = Key { scan, shift: pressed(VK_SHIFT), caps: b.caps, hkl };
        b.keys.push(key);
        if b.keys.len() > MAX_KEYS {
            b.keys.drain(..MAX_KEYS / 2);
        }
        b.version += 1;
    } else {
        // Enter, Tab, arrows, Home/End, Delete, numpad ... — the text context is lost.
        b.clear();
    }
    false
}

fn excluded_app(fg: isize) -> bool {
    thread_local! {
        static CACHE: RefCell<(u32, HashMap<u32, bool>)> = RefCell::new((u32::MAX, HashMap::new()));
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(fg as HWND, &mut pid) };
    let generation = EXCLUDED_GEN.load(Ordering::Relaxed);
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.0 != generation {
            *c = (generation, HashMap::new());
        }
        *c.1.entry(pid).or_insert_with(|| {
            let name = sys::process_name(pid).unwrap_or_default();
            EXCLUDED_APPS.read().map(|l| l.contains(&name)).unwrap_or(false)
        })
    })
}

/// Called when Space is pressed: if the word before it was typed in the wrong layout,
/// erase it, type it in the right layout and switch the layout. Returns true if corrected.
fn try_autocorrect(b: &mut Buffer) -> bool {
    let mode = AUTO_MODE.load(Ordering::Relaxed);
    let n = b.keys.len();
    if mode == AUTO_OFF || n == 0 || b.keys[n - 1].is_space() {
        return false;
    }
    let mut s = n;
    while s > 0 && !b.keys[s - 1].is_space() {
        s -= 1;
    }
    let t_hkl = b.keys[n - 1].hkl;
    if b.keys[s..n].iter().any(|k| k.hkl != t_hkl) || excluded_app(b.last_hwnd) {
        return false;
    }
    let Ok(layouts) = LAYOUTS.read() else { return false };
    let Some(tl) = layouts.iter().find(|l| l.hkl == t_hkl) else { return false };
    let Some(t_lang) = tl.lang else { return false };
    let Some(t_text) = tl.render_keys(&b.keys[s..n]) else { return false };
    let t_norm = auto::normalize(t_lang, &t_text).trim_matches(|c: char| !c.is_alphanumeric()).to_string();
    if let Ok(ex) = EXCEPTIONS.lock()
        && ex.as_ref().is_some_and(|e| e.contains(&t_norm))
    {
        return false;
    }

    let target = (mode & 0x100 != 0).then_some((mode & 0x3FF) as u16);
    let mut cand_layouts = Vec::new();
    let mut cand_texts = Vec::new();
    for l in layouts.iter() {
        let Some(lang) = l.lang else { continue };
        if l.hkl == t_hkl || lang == t_lang || target.is_some_and(|p| p != l.primary) {
            continue;
        }
        // One layout per language is enough.
        if cand_layouts.iter().any(|c: &&crate::layouts::LayoutInfo| c.lang == Some(lang)) {
            continue;
        }
        if let Some(t) = l.render_keys(&b.keys[s..n]) {
            cand_layouts.push(l);
            cand_texts.push((lang, t));
        }
    }
    let pairs: Vec<(Lang, &str)> = cand_texts.iter().map(|(l, t)| (*l, t.as_str())).collect();
    let pref = Lang::from_primary(AUTO_PREF.load(Ordering::Relaxed) as u16);
    let Some(i) = auto::decide(t_lang, &t_text, &pairs, pref, target.is_some()) else { return false };
    let g = cand_layouts[i];
    let g_lang = cand_texts[i].0;

    // Also fix one-letter words typed just before in the same wrong layout ("z ns" -> "я ти").
    let mut start = s;
    for _ in 0..3 {
        let mut e = start;
        while e > 0 && b.keys[e - 1].is_space() {
            e -= 1;
        }
        if e == start || e == 0 || (e >= 2 && !b.keys[e - 2].is_space()) {
            break;
        }
        let k = b.keys[e - 1];
        let (Some(tc), Some(gc)) = (tl.render(&k), g.render(&k)) else { break };
        if k.hkl != t_hkl || !auto::fix_single_letter(t_lang, tc, g_lang, gc) {
            break;
        }
        start = e - 1;
    }

    let Some(out) = g.render_keys(&b.keys[start..n]) else { return false };
    let g_hkl = g.hkl;
    drop(layouts);

    sys::backspaces(n - start);
    sys::type_text(&format!("{out} "));
    sys::activate_layout(g_hkl);

    for k in &mut b.keys[start..n] {
        k.hkl = g_hkl;
    }
    b.keys.push(Key { scan: SCAN_SPACE, shift: false, caps: b.caps, hkl: g_hkl });
    b.version += 1;
    b.set_pending(g_hkl);
    b.undo = Some(AutoUndo { version: b.version, start, end: n, from: t_hkl, word: t_norm });
    true
}

unsafe extern "system" fn kb_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        if code == HC_ACTION as i32 && ENABLED.load(Ordering::Relaxed) {
            let k = &*(lparam as *const KBDLLHOOKSTRUCT);
            // Our own SendInput events (and other programs' synthetic input) are ignored.
            if k.flags & LLKHF_INJECTED == 0 {
                let down = wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
                if on_key(k, down) {
                    return 1;
                }
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        if code == HC_ACTION as i32 {
            let m = wparam as u32;
            if matches!(m, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MBUTTONDOWN | WM_XBUTTONDOWN)
                && let Ok(mut b) = BUF.try_lock()
            {
                b.clear();
                b.shift_clean = false;
                b.last_shift_tap = 0;
            }
        }
        CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
    }
}

pub fn start(main_hwnd: HWND) {
    MAIN_HWND.store(main_hwnd as isize, Ordering::Relaxed);
    if let Ok(mut b) = BUF.lock() {
        b.caps = unsafe { GetKeyState(VK_CAPITAL as i32) } & 1 != 0;
    }
    std::thread::spawn(|| unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
        let hmod = GetModuleHandleW(std::ptr::null());
        SetWindowsHookExW(WH_KEYBOARD_LL, Some(kb_proc), hmod, 0);
        SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), hmod, 0);
        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    });
}
