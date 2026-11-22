//! Снимок установленных раскладок в виде таблиц, чтобы хук клавиатуры мог
//! перепечатывать слова без вызовов Windows API.

use std::sync::RwLock;

use crate::auto::Lang;
use crate::hook::Key;
use crate::keymap::{Builtin, KeyMap, SCAN_SPACE, SCANS, WinMap};

pub struct LayoutInfo {
    pub hkl: isize,
    pub primary: u16,
    pub lang: Option<Lang>,
    /// Для каждой клавиши из `SCANS`: [обычно, shift, caps, shift+caps]; '\0' — нет символа.
    table: Vec<[char; 4]>,
}

/// «Виртуальная» раскладка для языка, раскладка которого не установлена в Windows:
/// у неё отрицательный hkl, переключиться на неё нельзя, но печатать её буквами можно.
pub fn is_virtual(hkl: isize) -> bool {
    hkl < 0
}

impl LayoutInfo {
    fn build(hkl: isize) -> Self {
        Self::from_map(hkl, (hkl as usize & 0x3FF) as u16, &WinMap::new(hkl))
    }

    fn build_virtual(primary: u16) -> Option<Self> {
        let map = Builtin::for_primary_lang(primary)?;
        Some(Self::from_map(-(primary as isize), primary, &map))
    }

    fn from_map(hkl: isize, primary: u16, map: &dyn KeyMap) -> Self {
        let table = SCANS
            .iter()
            .map(|&s| {
                let r = |shift, caps| map.render(s, shift, caps).unwrap_or('\0');
                [r(false, false), r(true, false), r(false, true), r(true, true)]
            })
            .collect();
        LayoutInfo { hkl, primary, lang: Lang::from_primary(primary), table }
    }

    pub fn render(&self, k: &Key) -> Option<char> {
        if k.scan == SCAN_SPACE {
            return Some(' ');
        }
        let i = SCANS.iter().position(|&s| s == k.scan)?;
        let c = self.table[i][k.shift as usize | (k.caps as usize) << 1];
        (c != '\0').then_some(c)
    }

    pub fn render_keys(&self, keys: &[Key]) -> Option<String> {
        keys.iter().map(|k| self.render(k)).collect()
    }
}

pub static LAYOUTS: RwLock<Vec<LayoutInfo>> = RwLock::new(Vec::new());

/// Перестроить таблицы, если набор установленных раскладок изменился.
pub fn refresh(installed: &[isize]) {
    let same = LAYOUTS
        .read()
        .map(|l| l.iter().filter(|i| !is_virtual(i.hkl)).map(|i| i.hkl).eq(installed.iter().copied()))
        .unwrap_or(false);
    if same {
        return;
    }
    let mut infos: Vec<LayoutInfo> = installed.iter().map(|&h| LayoutInfo::build(h)).collect();
    for p in [0x09u16, 0x22, 0x19] {
        if !infos.iter().any(|i| i.primary == p)
            && let Some(v) = LayoutInfo::build_virtual(p)
        {
            infos.push(v);
        }
    }
    if let Ok(mut l) = LAYOUTS.write() {
        *l = infos;
    }
}
