"""Shared helpers: keyboard tables, alphabets and the trigram model (mirrors src/keymap.rs / src/auto.rs)."""
import math, collections

SCANS = [0x29] + list(range(0x02, 0x0E)) + list(range(0x10, 0x1C)) + list(range(0x1E, 0x29)) + [0x2B] + list(range(0x2C, 0x36))
LAYOUTS = {
    "en": ("`1234567890-=qwertyuiop[]asdfghjkl;'\\zxcvbnm,./", "~!@#$%^&*()_+QWERTYUIOP{}ASDFGHJKL:\"|ZXCVBNM<>?"),
    "uk": ("'1234567890-=йцукенгшщзхїфівапролджєґячсмитьбю.", "₴!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЇФІВАПРОЛДЖЄҐЯЧСМИТЬБЮ,"),
    "ru": ("ё1234567890-=йцукенгшщзхъфывапролджэ\\ячсмитьбю.", "Ё!\"№;%:?*()_+ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭ/ЯЧСМИТЬБЮ,"),
}
# Model alphabets; index 0 is the word boundary.
ALPHA = {
    "en": "_abcdefghijklmnopqrstuvwxyz'",
    "uk": "_абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'",
    "ru": "_абвгдежзийклмнопрстуфхцчшщъыьэюя",
}

def norm(lang, w):
    w = w.lower().replace("’", "'").replace("ʼ", "'")
    if lang == "ru":
        w = w.replace("ё", "е")
    return w

def valid(lang, w):
    a = ALPHA[lang]
    return len(w) > 0 and all(c in a[1:] for c in w) and not w.startswith("'") and not w.endswith("'")

def locate(lang, ch):
    n, s = LAYOUTS[lang]
    if ch in n: return (SCANS[n.index(ch)], False)
    if ch in s: return (SCANS[s.index(ch)], True)
    return None

def render(lang, scan, shift):
    n, s = LAYOUTS[lang]
    i = SCANS.index(scan)
    return s[i] if shift else n[i]

def retype(word, src, dst):
    out = []
    for c in word:
        k = locate(src, c)
        if k is None: return None
        out.append(render(dst, *k))
    return "".join(out)

def load(lang, path):
    words = []
    for line in open(path, encoding="utf-8"):
        p = line.split()
        if len(p) != 2: continue
        w = norm(lang, p[0])
        if valid(lang, w):
            words.append((w, int(p[1])))
    seen, out = set(), []
    for w, c in words:
        if w not in seen:
            seen.add(w); out.append((w, c))
    return out

def train(lang, words):
    a = ALPHA[lang]; n = len(a)
    idx = {c: i for i, c in enumerate(a)}
    cnt = [0.0] * (n ** 3)
    for w, c in words:
        weight = 1.0 + math.log(c)
        s = [0, 0] + [idx[ch] for ch in w] + [0]
        for i in range(len(s) - 2):
            cnt[(s[i] * n + s[i + 1]) * n + s[i + 2]] += weight
    # conditional P(c | a b) with add-k smoothing, quantized to u8: q = round(-log2(p) * 8), capped
    q = bytearray(n ** 3)
    for ab in range(n * n):
        row = cnt[ab * n:(ab + 1) * n]
        tot = sum(row) + 0.1 * n
        for c in range(n):
            p = (row[c] + 0.1) / tot
            q[ab * n + c] = min(255, round(-math.log2(p) * 8))
    return q

def score(lang, q, w):
    """Average -log2 P per symbol (lower = more plausible)."""
    a = ALPHA[lang]; n = len(a)
    idx = {c: i for i, c in enumerate(a)}
    s = [0, 0] + [idx[ch] for ch in w] + [0]
    tot = 0
    for i in range(len(s) - 2):
        tot += q[(s[i] * n + s[i + 1]) * n + s[i + 2]]
    return tot / 8 / (len(s) - 2)
