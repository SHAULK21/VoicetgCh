//! Snapshot of the installed keyboard layouts, rendered into lookup tables so that the
//! keyboard hook can re-render words without calling the Windows API.

use std::sync::RwLock;

use crate::auto::Lang;
use crate::hook::Key;
use crate::keymap::{KeyMap, SCAN_SPACE, SCANS, WinMap};

pub struct LayoutInfo {
    pub hkl: isize,
    pub primary: u16,
    pub lang: Option<Lang>,
    /// For every key in `SCANS`: [plain, shift, caps, shift+caps]; '\0' = no character.
    table: Vec<[char; 4]>,
}

impl LayoutInfo {
    fn build(hkl: isize) -> Self {
        let map = WinMap::new(hkl);
        let table = SCANS
            .iter()
            .map(|&s| {
                let r = |shift, caps| map.render(s, shift, caps).unwrap_or('\0');
                [r(false, false), r(true, false), r(false, true), r(true, true)]
            })
            .collect();
        let primary = (hkl as usize & 0x3FF) as u16;
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

/// Rebuild the tables if the set of installed layouts changed.
pub fn refresh(installed: &[isize]) {
    let same = LAYOUTS.read().map(|l| l.iter().map(|i| i.hkl).eq(installed.iter().copied())).unwrap_or(false);
    if same {
        return;
    }
    let infos: Vec<LayoutInfo> = installed.iter().map(|&h| LayoutInfo::build(h)).collect();
    if let Ok(mut l) = LAYOUTS.write() {
        *l = infos;
    }
}
