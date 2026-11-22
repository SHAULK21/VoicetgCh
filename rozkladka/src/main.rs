//! Rozkladka — маленький портативный аналог Punto Switcher для Windows.
//!
//! На лету: слово, набранное не в той раскладке, исправляется после пробела (Pause — отмена).
//! Pause              — исправить последнее слово (ещё раз — следующая раскладка)
//! Двойной Shift      — то же, что Pause (для ноутбуков без Pause)
//! Ctrl+Pause         — исправить всю последнюю фразу
//! Shift+Pause        — исправить выделенный текст
//! Alt+Pause          — иНВЕРСИЯ рЕГИСТРА выделения / последнего слова (забытый CapsLock)
//! Alt+Shift+Pause    — строчные -> ПРОПИСНЫЕ -> Каждое Слово
//! Ctrl+Shift+Pause   — транслитерация  Привіт <-> Pryvit

#![cfg_attr(windows, windows_subsystem = "windows")]

mod auto;
mod convert;
mod keymap;

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod hook;
#[cfg(windows)]
mod layouts;
#[cfg(windows)]
mod sys;

#[cfg(windows)]
fn main() {
    app::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Rozkladka работает только в Windows. Сборка: cargo build --release --target x86_64-pc-windows-gnu");
}
