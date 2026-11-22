//! Соответствие «физическая клавиша <-> символ» для раскладок клавиатуры.
//!
//! Каждая нажатая клавиша запоминается по *скан-коду* (физическому положению на
//! клавиатуре), поэтому ту же последовательность клавиш можно «перепечатать» в любой
//! другой раскладке. В Windows опрашиваются реально установленные раскладки (`WinMap`),
//! так что работает любая раскладка пользователя (украинская, украинская расширенная,
//! русская, немецкая, польская …). Встроенные таблицы EN / UK / RU — запасной вариант и для тестов.

/// Скан-код пробела.
pub const SCAN_SPACE: u16 = 0x39;

/// Скан-коды 47 «символьных» клавиш стандартной клавиатуры, по рядам:
/// `1234567890-=`, `qwertyuiop[]`, `asdfghjkl;'`, `\`, `zxcvbnm,./`.
pub const SCANS: [u16; 47] = [
    0x29, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, //
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, //
    0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, //
    0x2B, //
    0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35,
];

/// Входит ли скан-код в клавиши, которые мы отслеживаем при наборе?
pub fn is_char_scan(scan: u16) -> bool {
    SCANS.contains(&scan)
}

pub trait KeyMap {
    /// Символ, который даёт физическая клавиша `scan` при данном состоянии Shift / CapsLock.
    fn render(&self, scan: u16, shift: bool, caps: bool) -> Option<char>;
    /// Физическая клавиша (скан-код) и состояние Shift, которые дают символ `ch`.
    fn locate(&self, ch: char) -> Option<(u16, bool)>;
}

pub struct Builtin {
    normal: Vec<char>,
    shifted: Vec<char>,
}

impl Builtin {
    fn new(normal: &str, shifted: &str) -> Self {
        let b = Builtin { normal: normal.chars().collect(), shifted: shifted.chars().collect() };
        debug_assert_eq!(b.normal.len(), SCANS.len());
        debug_assert_eq!(b.shifted.len(), SCANS.len());
        b
    }

    pub fn en() -> Self {
        Self::new(
            "`1234567890-=qwertyuiop[]asdfghjkl;'\\zxcvbnm,./",
            "~!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:\"|ZXCVBNM<>?",
        )
    }

    /// Украинская (расширенная): `'` на клавише тильды, `ґ` на клавише обратной косой черты.
    pub fn uk() -> Self {
        Self::new(
            "'1234567890-=йцукенгшщзхїфівапролджєґячсмитьбю.",
            "₴!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЇФІВАПРОЛДЖЄҐЯЧСМИТЬБЮ,",
        )
    }

    pub fn ru() -> Self {
        Self::new(
            "ё1234567890-=йцукенгшщзхъфывапролджэ\\ячсмитьбю.",
            "Ё!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭ/ЯЧСМИТЬБЮ,",
        )
    }

    /// Встроенная таблица для основного языка Windows (младшие 10 бит LANGID).
    pub fn for_primary_lang(primary: u16) -> Option<Self> {
        match primary {
            0x09 => Some(Self::en()),
            0x22 => Some(Self::uk()),
            0x19 => Some(Self::ru()),
            _ => None,
        }
    }
}

impl KeyMap for Builtin {
    fn render(&self, scan: u16, shift: bool, caps: bool) -> Option<char> {
        if scan == SCAN_SPACE {
            return Some(' ');
        }
        let i = SCANS.iter().position(|&s| s == scan)?;
        let n = self.normal[i];
        let upper = if n.is_alphabetic() { shift ^ caps } else { shift };
        Some(if upper { self.shifted[i] } else { n })
    }

    fn locate(&self, ch: char) -> Option<(u16, bool)> {
        if ch == ' ' {
            return Some((SCAN_SPACE, false));
        }
        if let Some(i) = self.normal.iter().position(|&c| c == ch) {
            return Some((SCANS[i], false));
        }
        self.shifted.iter().position(|&c| c == ch).map(|i| (SCANS[i], true))
    }
}

/// Настоящая раскладка Windows (HKL) со встроенной таблицей как запасным вариантом.
#[cfg(windows)]
pub struct WinMap {
    hkl: windows_sys::Win32::UI::Input::KeyboardAndMouse::HKL,
    fallback: Option<Builtin>,
}

#[cfg(windows)]
impl WinMap {
    pub fn new(hkl: isize) -> Self {
        let primary = (hkl as usize & 0x3FF) as u16;
        WinMap { hkl: hkl as _, fallback: Builtin::for_primary_lang(primary) }
    }
}

#[cfg(windows)]
impl KeyMap for WinMap {
    fn render(&self, scan: u16, shift: bool, caps: bool) -> Option<char> {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
        if scan == SCAN_SPACE {
            return Some(' ');
        }
        let api = unsafe {
            let vk = MapVirtualKeyExW(scan as u32, MAPVK_VSC_TO_VK_EX, self.hkl);
            if vk == 0 {
                None
            } else {
                let mut state = [0u8; 256];
                if shift {
                    state[VK_SHIFT as usize] = 0x80;
                    state[VK_LSHIFT as usize] = 0x80;
                }
                if caps {
                    state[VK_CAPITAL as usize] = 0x01;
                }
                let mut buf = [0u16; 8];
                // wFlags = 4: не менять состояние клавиатуры (без побочных эффектов «мёртвых» клавиш).
                let n = ToUnicodeEx(vk, scan as u32, state.as_ptr(), buf.as_mut_ptr(), buf.len() as i32, 4, self.hkl);
                if n == 1 || n == -1 {
                    char::from_u32(buf[0] as u32).filter(|c| !c.is_control())
                } else {
                    None
                }
            }
        };
        api.or_else(|| self.fallback.as_ref().and_then(|f| f.render(scan, shift, caps)))
    }

    fn locate(&self, ch: char) -> Option<(u16, bool)> {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
        if ch == ' ' {
            return Some((SCAN_SPACE, false));
        }
        let mut units = [0u16; 2];
        if ch.encode_utf16(&mut units).len() == 1 {
            let r = unsafe { VkKeyScanExW(units[0], self.hkl) };
            if r != -1 {
                let vk = (r as u16 & 0xFF) as u32;
                let mods = (r as u16 >> 8) & 0xFF;
                // Символы, которым нужен Ctrl / Alt (AltGr), — не «обычные» клавиши.
                if mods & 0b110 == 0 {
                    let scan = unsafe { MapVirtualKeyExW(vk, MAPVK_VK_TO_VSC, self.hkl) } as u16;
                    if scan != 0 {
                        return Some((scan, mods & 1 != 0));
                    }
                }
                return None;
            }
        }
        self.fallback.as_ref().and_then(|f| f.locate(ch))
    }
}
