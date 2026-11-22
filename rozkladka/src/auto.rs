//! On-the-fly correction: decides whether a word was typed in the wrong layout.
//!
//! For every language there is a Bloom filter with the 50 000 most frequent words and a
//! letter-trigram model (see `tools/build_model.py`). A word typed in layout T is replaced by
//! its rendering in layout G when the G-version is a known word (or looks much more like the
//! language G than the original looks like T) and the original is not a known word of T.
//! Thresholds were tuned on held-out words: ~98% of common mistyped words are fixed while only
//! ~0.2% of rare, correctly typed words get touched (and Pause undoes it).

use std::sync::OnceLock;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    En,
    Uk,
    Ru,
}

impl Lang {
    pub fn from_primary(p: u16) -> Option<Lang> {
        match p {
            0x09 => Some(Lang::En),
            0x22 => Some(Lang::Uk),
            0x19 => Some(Lang::Ru),
            _ => None,
        }
    }

    fn idx(self) -> usize {
        self as usize
    }

    fn cyrillic(self) -> bool {
        self != Lang::En
    }

    /// Real one-letter words (one-letter words are never corrected by the models).
    fn single_letter_words(self) -> &'static str {
        match self {
            Lang::En => "ai",
            Lang::Uk => "авзійоуяж",
            Lang::Ru => "авикосуяжб",
        }
    }
}

// Same alphabets as tools/lm.py (index 0 = word boundary).
const ALPHA: [&str; 3] = [
    "_abcdefghijklmnopqrstuvwxyz'",
    "_абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'",
    "_абвгдежзийклмнопрстуфхцчшщъыьэюя",
];
const TRI: [&[u8]; 3] = [
    include_bytes!("../data/en.tri"),
    include_bytes!("../data/uk.tri"),
    include_bytes!("../data/ru.tri"),
];
const BLOOM: [&[u8]; 3] = [
    include_bytes!("../data/en.bloom"),
    include_bytes!("../data/uk.bloom"),
    include_bytes!("../data/ru.bloom"),
];

/// Minimum log-likelihood gain (bits) for a dictionary hit: Latin<->Cyrillic / Cyrillic<->Cyrillic.
/// Ukrainian and Russian share most words, so between them we need more evidence — unless the
/// user explicitly chose the target language.
const K_DICT: f32 = 2.0;
const K_DICT_CYR: f32 = 4.0;
const K_DICT_CYR_TARGET: f32 = 0.5;
/// Without a dictionary hit: minimum gain, maximum average bits/symbol, minimum word length.
const K_MODEL: f32 = 10.0;
const MAX_AVG_BITS: f32 = 4.5;
const MIN_LEN_MODEL: usize = 4;

struct Model {
    alpha: Vec<char>,
    tri: &'static [u8],
    bloom: &'static [u8],
    m: u32,
    k: u8,
}

fn models() -> &'static [Model; 3] {
    static M: OnceLock<[Model; 3]> = OnceLock::new();
    M.get_or_init(|| {
        std::array::from_fn(|i| {
            let alpha: Vec<char> = ALPHA[i].chars().collect();
            let n = alpha.len();
            assert_eq!(TRI[i].len(), n * n * n);
            let b = BLOOM[i];
            let m = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
            Model { alpha, tri: TRI[i], bloom: &b[5..], m, k: b[4] }
        })
    })
}

fn model(l: Lang) -> &'static Model {
    &models()[l.idx()]
}

fn fnv1a(data: &[u8]) -> u64 {
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x0100_0000_01B3);
    }
    h
}

/// Is `w` (normalized) one of the frequent words of the language?
pub fn in_dict(l: Lang, w: &str) -> bool {
    let md = model(l);
    let h = fnv1a(w.as_bytes());
    let (h1, h2) = (h & 0xFFFF_FFFF, (h >> 32) | 1);
    (0..md.k as u64).all(|i| {
        let bit = (h1 + i * h2) % md.m as u64;
        md.bloom[(bit / 8) as usize] & (1 << (bit % 8)) != 0
    })
}

fn norm_char(l: Lang, c: char) -> char {
    match c.to_lowercase().next().unwrap_or(c) {
        '’' | 'ʼ' => '\'',
        'ё' if l == Lang::Ru => 'е',
        c => c,
    }
}

/// Lower case, unified apostrophe, `ё` -> `е` for Russian.
pub fn normalize(l: Lang, s: &str) -> String {
    s.chars().map(|c| norm_char(l, c)).collect()
}

fn sym(md: &Model, c: char) -> Option<usize> {
    md.alpha.iter().skip(1).position(|&a| a == c).map(|i| i + 1)
}

/// Average -log2 P per symbol of a normalized word (lower = more plausible).
pub fn score(l: Lang, w: &str) -> Option<f32> {
    let md = model(l);
    let n = md.alpha.len();
    let mut s = vec![0usize, 0];
    for c in w.chars() {
        s.push(sym(md, c)?);
    }
    s.push(0);
    let mut total = 0u32;
    for t in s.windows(3) {
        total += md.tri[(t[0] * n + t[1]) * n + t[2]] as u32;
    }
    Some(total as f32 / 8.0 / (s.len() - 2) as f32)
}

/// The word itself without punctuation around it, if it consists of letters of the language only.
/// Returns (normalized, original-case) forms.
fn core(l: Lang, text: &str) -> Option<(String, String)> {
    let md = model(l);
    let is_letter = |c: char| {
        let n = norm_char(l, c);
        n != '\'' && sym(md, n).is_some()
    };
    let orig = text.trim_matches(|c: char| !is_letter(c));
    if orig.is_empty() {
        return None;
    }
    let norm = normalize(l, orig);
    if norm.chars().all(|c| sym(md, c).is_some()) { Some((norm, orig.to_string())) } else { None }
}

/// Only lower case, UPPER CASE or Title case words are corrected (not iPhone, McDonald etc.).
fn case_ok(orig: &str) -> bool {
    let letters: Vec<char> = orig.chars().filter(|c| c.is_alphabetic()).collect();
    let rest_lower = letters.iter().skip(1).all(|c| !c.is_uppercase());
    let all_upper = letters.iter().all(|c| !c.is_lowercase());
    rest_lower || all_upper
}

/// Decide whether `t_text` (as typed in a layout of language `t_lang`) should be replaced by one
/// of `cands` (the same keys rendered in other layouts). Returns the index of the candidate.
/// `target_mode`: the user picked one target language (cands then holds only that language).
pub fn decide(t_lang: Lang, t_text: &str, cands: &[(Lang, &str)], pref: Option<Lang>, target_mode: bool) -> Option<usize> {
    let t = core(t_lang, t_text);
    if let Some((tn, to)) = &t
        && (in_dict(t_lang, tn) || !case_ok(to))
    {
        return None;
    }
    let st = t.as_ref().and_then(|(tn, _)| score(t_lang, tn)).unwrap_or(99.0);

    let mut hits: Vec<usize> = Vec::new();
    let mut best: Option<(usize, f32)> = None;
    for (i, &(g_lang, g_text)) in cands.iter().enumerate() {
        if g_lang == t_lang {
            continue;
        }
        let Some((gn, go)) = core(g_lang, g_text) else { continue };
        let len = gn.chars().count();
        if len < 2 || t.as_ref().is_some_and(|(tn, _)| *tn == gn) || !case_ok(&go) {
            continue;
        }
        let Some(sg) = score(g_lang, &gn) else { continue };
        let gain = (st - sg) * (len + 1) as f32;
        if in_dict(g_lang, &gn) {
            let k = match (t_lang.cyrillic() && g_lang.cyrillic(), target_mode) {
                (false, _) => K_DICT,
                (true, false) => K_DICT_CYR,
                (true, true) => K_DICT_CYR_TARGET,
            };
            if gain > k {
                hits.push(i);
            }
        } else if len >= MIN_LEN_MODEL && gain > K_MODEL && sg < MAX_AVG_BITS && best.is_none_or(|(_, b)| sg < b) {
            best = Some((i, sg));
        }
    }
    if !hits.is_empty() {
        return hits.iter().copied().find(|&i| Some(cands[i].0) == pref).or(Some(hits[0]));
    }
    best.map(|b| b.0)
}

/// A one-letter word typed right before a corrected word: fix it too if it is a real one-letter
/// word in the target language but not in the typed one (e.g. `z ns` -> `я ти`).
pub fn fix_single_letter(t_lang: Lang, t: char, g_lang: Lang, g: char) -> bool {
    let (t, g) = (t.to_lowercase().next().unwrap_or(t), g.to_lowercase().next().unwrap_or(g));
    g_lang.single_letter_words().contains(g) && !t_lang.single_letter_words().contains(t)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap::{Builtin, KeyMap};
    use Lang::*;

    fn retype(text: &str, from: &dyn KeyMap, to: &dyn KeyMap) -> String {
        crate::convert::convert_text(text, from, to)
    }

    /// Simulates typing `text` in layout `t` with EN / UK / RU installed ("all languages" mode).
    fn auto(t: Lang, text: &str, pref: Option<Lang>) -> Option<String> {
        run(t, text, pref, None)
    }

    /// Same with one chosen target language.
    fn to(target: Lang, t: Lang, text: &str) -> Option<String> {
        run(t, text, None, Some(target))
    }

    fn run(t: Lang, text: &str, pref: Option<Lang>, target: Option<Lang>) -> Option<String> {
        let maps = [(En, Builtin::en()), (Uk, Builtin::uk()), (Ru, Builtin::ru())];
        let from = &maps.iter().find(|m| m.0 == t).unwrap().1;
        let rendered: Vec<(Lang, String)> = maps
            .iter()
            .filter(|m| m.0 != t && target.is_none_or(|g| g == m.0))
            .map(|m| (m.0, retype(text, from, &m.1)))
            .collect();
        let cands: Vec<(Lang, &str)> = rendered.iter().map(|(l, s)| (*l, s.as_str())).collect();
        decide(t, text, &cands, pref, target.is_some()).map(|i| rendered[i].1.clone())
    }

    #[test]
    fn matches_python_model() {
        assert_eq!(fnv1a(b"hello"), 0xa430d84680aabd0b);
        assert!((score(En, "hello").unwrap() - 3.4375).abs() < 1e-4);
        assert!((score(Uk, "привіт").unwrap() - 3.035_714).abs() < 1e-4);
        assert!((score(En, "ghbdtn").unwrap() - 7.642_857).abs() < 1e-4);
        for (l, w) in [(En, "hello"), (En, "the"), (Uk, "привіт"), (Uk, "дякую"), (Ru, "привет"), (Ru, "спасибо")] {
            assert!(in_dict(l, w), "{w}");
        }
        assert!(!in_dict(En, "ghbdtn"));
        assert!(!in_dict(Ru, "руддщ"));
    }

    #[test]
    fn fixes_wrong_layout() {
        assert_eq!(auto(En, "ghbdsn", None).as_deref(), Some("привіт"));
        assert_eq!(auto(En, "ghbdtn", Some(Ru)).as_deref(), Some("привет"));
        assert_eq!(auto(En, "Lzre.", Some(Uk)).as_deref(), Some("Дякую"));
        assert_eq!(auto(Ru, "руддщ", None).as_deref(), Some("hello"));
        assert_eq!(auto(Uk, "цщкдв", None).as_deref(), Some("world"));
        assert_eq!(auto(Ru, "ЕУЫЕ", None).as_deref(), Some("TEST"));
        assert_eq!(auto(En, "cgfcb,j", Some(Ru)).as_deref(), Some("спасибо"));
        assert_eq!(auto(En, "nfr", Some(Uk)).as_deref(), Some("так"));
        // Russian typed in the Ukrainian layout and vice versa
        assert_eq!(auto(Uk, "спасибо", None), None); // identical in both layouts
        assert_eq!(auto(Uk, "щоб", None), None);
    }

    #[test]
    fn target_language() {
        // "Everything into Ukrainian": Russian-layout typos become Ukrainian too.
        assert_eq!(to(Uk, Ru, "привыт").as_deref(), Some("привіт"));
        assert_eq!(to(Uk, En, "ghbdsn").as_deref(), Some("привіт"));
        assert_eq!(to(Uk, En, "hello"), None); // real English words stay
        assert_eq!(to(Ru, Uk, "привіт"), None); // real Ukrainian word stays even in RU mode? it's a valid word of the typed layout
        assert_eq!(to(En, Uk, "руддщ").as_deref(), Some("hello"));
        assert_eq!(to(En, Ru, "привет"), None);
        // In "all languages" mode we are more careful between Ukrainian and Russian.
        assert_eq!(auto(Ru, "привыт", Some(Uk)), None);
    }

    #[test]
    fn keeps_correct_words() {
        for w in ["hello", "world", "the", "is", "kubectl", "github", "iPhone", "ok", "lol"] {
            assert_eq!(auto(En, w, Some(Uk)), None, "{w}");
        }
        for w in ["привіт", "дякую", "щоб", "м'ясо", "їжак", "є"] {
            assert_eq!(auto(Uk, w, None), None, "{w}");
        }
        for w in ["привет", "спасибо", "это", "съешь", "ещё", "ы"] {
            assert_eq!(auto(Ru, w, None), None, "{w}");
        }
    }

    #[test]
    fn single_letters() {
        assert!(fix_single_letter(En, 'z', Uk, 'я'));
        assert!(!fix_single_letter(En, 'a', Uk, 'ф'));
        assert!(!fix_single_letter(En, 'i', Ru, 'ш'));
        assert!(fix_single_letter(Ru, 'ш', En, 'i'));
    }
}
