//! Rozkladka — a tiny portable Punto Switcher-like layout fixer for Windows.
//!
//! Pause              — fix the last typed word (press again to try the next layout)
//! Double Shift       — same as Pause (for laptops without a Pause key)
//! Ctrl+Pause         — fix the whole last typed phrase
//! Shift+Pause        — fix the selected text
//! Alt+Pause          — iNVERT cASE of the selection / last word (forgotten CapsLock)
//! Alt+Shift+Pause    — lower -> UPPER -> Title case
//! Ctrl+Shift+Pause   — transliteration  Привіт <-> Pryvit

#![cfg_attr(windows, windows_subsystem = "windows")]

mod convert;
mod keymap;

#[cfg(windows)]
mod app;
#[cfg(windows)]
mod hook;
#[cfg(windows)]
mod sys;

#[cfg(windows)]
fn main() {
    app::run();
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Rozkladka works on Windows only. Build with: cargo build --release --target x86_64-pc-windows-gnu");
}
