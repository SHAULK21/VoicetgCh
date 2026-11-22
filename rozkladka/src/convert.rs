//! Чистые преобразования текста (без Windows API), покрыты юнит-тестами.

use crate::keymap::KeyMap;

/// Перепечатать `text` так, будто те же клавиши нажимались в раскладке `to`, а не `from`.
pub fn convert_text(text: &str, from: &dyn KeyMap, to: &dyn KeyMap) -> String {
    text.chars()
        .map(|c| {
            if c.is_whitespace() || c.is_control() {
                return c;
            }
            match from.locate(c) {
                Some((scan, shift)) => to.render(scan, shift, false).unwrap_or(c),
                None => c,
            }
        })
        .collect()
}

/// Сколько букв `text` можно набрать в этой раскладке (для угадывания исходной раскладки).
pub fn layout_score(text: &str, map: &dyn KeyMap) -> usize {
    text.chars().filter(|c| c.is_alphabetic() && map.locate(*c).is_some()).count()
}

/// пРИВЕТ -> Привет  (исправляет текст, набранный со случайно включённым CapsLock).
pub fn invert_case(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if c.is_lowercase() {
            out.extend(c.to_uppercase());
        } else if c.is_uppercase() {
            out.extend(c.to_lowercase());
        } else {
            out.push(c);
        }
    }
    out
}

/// строчные -> ПРОПИСНЫЕ -> Каждое Слово -> строчные …
pub fn cycle_case(text: &str) -> String {
    let letters: Vec<char> = text.chars().filter(|c| c.is_alphabetic()).collect();
    if letters.is_empty() {
        return text.to_string();
    }
    if letters.iter().all(|c| !c.is_uppercase()) {
        text.to_uppercase()
    } else if letters.iter().all(|c| !c.is_lowercase()) {
        title_case(text)
    } else {
        text.to_lowercase()
    }
}

fn is_apostrophe(c: char) -> bool {
    matches!(c, '\'' | '’' | 'ʼ' | '`')
}

pub fn title_case(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_word = false;
    for c in text.chars() {
        if c.is_alphanumeric() {
            if in_word {
                out.extend(c.to_lowercase());
            } else {
                out.extend(c.to_uppercase());
            }
            in_word = true;
        } else {
            out.push(c);
            in_word = in_word && is_apostrophe(c);
        }
    }
    out
}

fn is_cyrillic(c: char) -> bool {
    ('\u{0400}'..='\u{04FF}').contains(&c)
}

/// Похож ли текст на украинский (`Some(true)`), русский (`Some(false)`) или непонятно (`None`)?
pub fn guess_ukrainian(text: &str) -> Option<bool> {
    let lower = text.to_lowercase();
    if lower.chars().any(|c| matches!(c, 'і' | 'ї' | 'є' | 'ґ')) {
        Some(true)
    } else if lower.chars().any(|c| matches!(c, 'ы' | 'э' | 'ъ' | 'ё')) {
        Some(false)
    } else {
        None
    }
}

/// Кириллица -> латиница, или латиница -> кириллица, если в тексте нет кириллицы.
/// `prefer_uk` выбирает между украинским и русским, когда по тексту это не понять.
pub fn translit(text: &str, prefer_uk: bool) -> String {
    if text.chars().any(is_cyrillic) {
        let uk = guess_ukrainian(text).unwrap_or(prefer_uk);
        cyr_to_lat(text, uk)
    } else {
        lat_to_cyr(text, prefer_uk)
    }
}

/// Перенести регистр исходной буквы на многобуквенную замену.
fn push_cased(out: &mut String, rep: &str, upper: bool, all_caps: bool) {
    if !upper {
        out.push_str(rep);
    } else if all_caps {
        out.push_str(&rep.to_uppercase());
    } else {
        let mut it = rep.chars();
        if let Some(f) = it.next() {
            out.extend(f.to_uppercase());
            out.extend(it);
        }
    }
}

/// Входит ли буква `i` в слово ПРОПИСНЫМИ (тогда многобуквенная замена тоже прописная)?
fn all_caps_at(chars: &[char], i: usize) -> bool {
    let next = chars.get(i + 1).copied().filter(|c| c.is_alphabetic());
    let prev = if i > 0 { Some(chars[i - 1]).filter(|c| c.is_alphabetic()) } else { None };
    match next {
        Some(n) => n.is_uppercase(),
        None => prev.is_some_and(|p| p.is_uppercase()),
    }
}

fn cyr_to_lat(text: &str, uk: bool) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() * 2);
    for i in 0..chars.len() {
        let c = chars[i];
        let lc = c.to_lowercase().next().unwrap_or(c);
        let word_start = i == 0 || !(chars[i - 1].is_alphabetic() || is_apostrophe(chars[i - 1]));
        let prev_lower = if i > 0 { chars[i - 1].to_lowercase().next() } else { None };
        let rep: Option<&str> = if uk {
            // Официальная украинская транслитерация (постановление КМУ № 55, 2010).
            match lc {
                'а' => Some("a"),
                'б' => Some("b"),
                'в' => Some("v"),
                'г' => Some(if prev_lower == Some('з') { "gh" } else { "h" }),
                'ґ' => Some("g"),
                'д' => Some("d"),
                'е' => Some("e"),
                'є' => Some(if word_start { "ye" } else { "ie" }),
                'ж' => Some("zh"),
                'з' => Some("z"),
                'и' => Some("y"),
                'і' => Some("i"),
                'ї' => Some(if word_start { "yi" } else { "i" }),
                'й' => Some(if word_start { "y" } else { "i" }),
                'к' => Some("k"),
                'л' => Some("l"),
                'м' => Some("m"),
                'н' => Some("n"),
                'о' => Some("o"),
                'п' => Some("p"),
                'р' => Some("r"),
                'с' => Some("s"),
                'т' => Some("t"),
                'у' => Some("u"),
                'ф' => Some("f"),
                'х' => Some("kh"),
                'ц' => Some("ts"),
                'ч' => Some("ch"),
                'ш' => Some("sh"),
                'щ' => Some("shch"),
                'ь' => Some(""),
                'ю' => Some(if word_start { "yu" } else { "iu" }),
                'я' => Some(if word_start { "ya" } else { "ia" }),
                // Русские буквы внутри украинского текста
                'ы' => Some("y"),
                'э' => Some("e"),
                'ё' => Some("yo"),
                'ъ' => Some(""),
                _ => None,
            }
        } else {
            match lc {
                'а' => Some("a"),
                'б' => Some("b"),
                'в' => Some("v"),
                'г' => Some("g"),
                'д' => Some("d"),
                'е' => Some("e"),
                'ё' => Some("yo"),
                'ж' => Some("zh"),
                'з' => Some("z"),
                'и' => Some("i"),
                'й' => Some("y"),
                'к' => Some("k"),
                'л' => Some("l"),
                'м' => Some("m"),
                'н' => Some("n"),
                'о' => Some("o"),
                'п' => Some("p"),
                'р' => Some("r"),
                'с' => Some("s"),
                'т' => Some("t"),
                'у' => Some("u"),
                'ф' => Some("f"),
                'х' => Some("kh"),
                'ц' => Some("ts"),
                'ч' => Some("ch"),
                'ш' => Some("sh"),
                'щ' => Some("shch"),
                'ъ' => Some(""),
                'ы' => Some("y"),
                'ь' => Some(""),
                'э' => Some("e"),
                'ю' => Some("yu"),
                'я' => Some("ya"),
                'і' => Some("i"),
                'ї' => Some("yi"),
                'є' => Some("ye"),
                'ґ' => Some("g"),
                _ => None,
            }
        };
        match rep {
            Some(r) => push_cased(&mut out, r, c.is_uppercase(), all_caps_at(&chars, i)),
            // Украинский апостроф при транслитерации опускается.
            None if uk && is_apostrophe(c) && i > 0 && chars[i - 1].is_alphabetic() && is_cyrillic(chars[i - 1]) => {}
            None => out.push(c),
        }
    }
    out
}

fn lat_to_cyr(text: &str, uk: bool) -> String {
    const VOWELS: &str = "aeiouy";
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().map(|c| c.to_ascii_lowercase()).collect();
    let mut out = String::with_capacity(text.len() * 2);
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if !c.is_ascii_alphabetic() {
            out.push(c);
            i += 1;
            continue;
        }
        let rest: String = lower[i..lower.len().min(i + 4)].iter().collect();
        let prev_vowel = i > 0 && VOWELS.contains(lower[i - 1]);
        let word_start = i == 0 || !chars[i - 1].is_alphabetic();
        let multi: &[(&str, &str)] = if uk {
            &[
                ("shch", "щ"), ("zgh", "зг"), ("zh", "ж"), ("kh", "х"), ("ts", "ц"), ("ch", "ч"),
                ("sh", "ш"), ("yu", "ю"), ("ya", "я"), ("ye", "є"), ("yi", "ї"), ("iu", "ю"),
                ("ia", "я"), ("ie", "є"),
            ]
        } else {
            &[
                ("shch", "щ"), ("zh", "ж"), ("kh", "х"), ("ts", "ц"), ("ch", "ч"), ("sh", "ш"),
                ("yu", "ю"), ("ya", "я"), ("yo", "ё"), ("ye", "е"),
            ]
        };
        let mut matched = None;
        for (lat, cyr) in multi {
            if rest.starts_with(lat) {
                matched = Some((lat.len(), *cyr));
                break;
            }
        }
        let (len, rep): (usize, String) = match matched {
            Some((l, r)) => (l, r.to_string()),
            None => {
                let l = lower[i];
                let r = match l {
                    'a' => "а",
                    'b' => "б",
                    'c' => "ц",
                    'd' => "д",
                    'e' => if !uk && word_start { "э" } else { "е" },
                    'f' => "ф",
                    'g' => if uk { "ґ" } else { "г" },
                    'h' => if uk { "г" } else { "х" },
                    'i' => if uk { "і" } else { "и" },
                    'j' => "й",
                    'k' => "к",
                    'l' => "л",
                    'm' => "м",
                    'n' => "н",
                    'o' => "о",
                    'p' => "п",
                    'q' => "к",
                    'r' => "р",
                    's' => "с",
                    't' => "т",
                    'u' => "у",
                    'v' => "в",
                    'w' => "в",
                    'x' => "кс",
                    'y' => {
                        if prev_vowel || word_start {
                            "й"
                        } else if uk {
                            "и"
                        } else {
                            "ы"
                        }
                    }
                    'z' => "з",
                    _ => "",
                };
                (1, r.to_string())
            }
        };
        let upper = c.is_ascii_uppercase();
        let all_caps = upper && {
            let next = chars.get(i + len).copied().filter(|c| c.is_ascii_alphabetic());
            match next {
                Some(n) => n.is_ascii_uppercase(),
                None => len > 1 && chars[i + 1].is_ascii_uppercase() || i > 0 && chars[i - 1].is_ascii_uppercase(),
            }
        };
        push_cased(&mut out, &rep, upper, all_caps);
        i += len;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keymap::Builtin;

    #[test]
    fn tables_are_complete() {
        for b in [Builtin::en(), Builtin::uk(), Builtin::ru()] {
            for &s in crate::keymap::SCANS.iter() {
                assert!(b.render(s, false, false).is_some());
                assert!(b.render(s, true, false).is_some());
            }
        }
    }

    #[test]
    fn en_to_uk_and_ru() {
        let (en, uk, ru) = (Builtin::en(), Builtin::uk(), Builtin::ru());
        assert_eq!(convert_text("ghbdsn", &en, &uk), "привіт");
        assert_eq!(convert_text("ghbdtn", &en, &ru), "привет");
        assert_eq!(convert_text("Ghbdtn? vbh!", &en, &ru), "Привет, мир!");
        assert_eq!(convert_text("v`zcj", &en, &uk), "м'ясо");
        assert_eq!(convert_text("\\fyjr", &en, &uk), "ґанок");
        assert_eq!(convert_text("'ne", &en, &ru), "эту");
    }

    #[test]
    fn back_to_en() {
        let (en, uk, ru) = (Builtin::en(), Builtin::uk(), Builtin::ru());
        assert_eq!(convert_text("руддщ цщкдв", &ru, &en), "hello world");
        assert_eq!(convert_text("Руддщ", &uk, &en), "Hello");
        assert_eq!(convert_text("м'ясо", &uk, &en), "v`zcj");
        assert_eq!(convert_text("ЕУЫЕ", &ru, &en), "TEST");
    }

    #[test]
    fn uk_ru_swap() {
        let (uk, ru) = (Builtin::uk(), Builtin::ru());
        assert_eq!(convert_text("привыт", &ru, &uk), "привіт");
        assert_eq!(convert_text("їжак", &uk, &ru), "ъжак");
    }

    #[test]
    fn score_detects_source() {
        let (en, uk, ru) = (Builtin::en(), Builtin::uk(), Builtin::ru());
        let t = "привіт";
        assert!(layout_score(t, &uk) > layout_score(t, &ru));
        assert_eq!(layout_score(t, &en), 0);
    }

    #[test]
    fn caps_render() {
        let ru = Builtin::ru();
        // Клавиша ';' с CapsLock в RU — буква Ж, а клавиша '.' остаётся '.'
        assert_eq!(ru.render(0x27, false, true), Some('Ж'));
        assert_eq!(ru.render(0x35, false, true), Some('.'));
        assert_eq!(Builtin::en().render(0x27, false, true), Some(';'));
    }

    #[test]
    fn cases() {
        assert_eq!(invert_case("пРИВЕТ, мИР"), "Привет, Мир");
        assert_eq!(cycle_case("привіт світ"), "ПРИВІТ СВІТ");
        assert_eq!(cycle_case("ПРИВІТ СВІТ"), "Привіт Світ");
        assert_eq!(cycle_case("Привіт Світ"), "привіт світ");
        assert_eq!(title_case("м'ясо і хліб"), "М'ясо І Хліб");
    }

    #[test]
    fn translit_uk() {
        assert_eq!(translit("Привіт, світ!", true), "Pryvit, svit!");
        assert_eq!(translit("Щука Згорани Юрій Їжак Яків", true), "Shchuka Zghorany Yurii Yizhak Yakiv");
        assert_eq!(translit("ЩУКА", true), "SHCHUKA");
        assert_eq!(translit("м'ясо", true), "miaso");
    }

    #[test]
    fn translit_ru() {
        assert_eq!(translit("Привет, мир! Съешь щи", false), "Privet, mir! Sesh shchi");
        assert_eq!(translit("Ёжик", false), "Yozhik");
    }

    #[test]
    fn translit_back() {
        assert_eq!(translit("Pryvit", true), "Привіт");
        assert_eq!(translit("Shchuka", true), "Щука");
        assert_eq!(translit("Privet, mir", false), "Привет, мир");
        assert_eq!(translit("SHCHI", false), "ЩИ");
    }
}
