//! Low-level keyboard / mouse hooks running on their own thread.
//!
//! The hook only records keystrokes (scan code + Shift/CapsLock + layout) and
//! detects hotkeys; the actual work is posted to the main window so the hook
//! callback stays fast.

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use windows_sys::Win32::Foundation::*;
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
use windows_sys::Win32::UI::WindowsAndMessaging::*;

use crate::keymap::{SCAN_SPACE, is_char_scan};

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
}

impl Buffer {
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
});

pub static ENABLED: AtomicBool = AtomicBool::new(true);
pub static DOUBLE_SHIFT: AtomicBool = AtomicBool::new(true);
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
    let scan = k.scanCode as u16;
    let extended = k.flags & LLKHF_EXTENDED != 0;
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
