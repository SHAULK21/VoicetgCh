"""Собирает языковые данные, встраиваемые в rozkladka.exe (data/*.tri, data/*.bloom).

Источник: частотные списки слов https://github.com/hermitdave/FrequencyWords
(OpenSubtitles 2018). Запуск:

    python3 build_model.py <папка с en_full.txt uk_full.txt ru_full.txt>

*.tri   - буквенная триграммная модель: n^3 байт, q = round(-log2 P(c | a b) * 8), алфавит в lm.ALPHA
*.bloom - фильтр Блума самых частых слов:
          u32 LE число бит, u8 число хешей, затем битовый массив (младший бит первым).
          Хеш: FNV-1a 64 от UTF-8; h1 = младшие 32 бита, h2 = старшие 32 бита | 1; бит_i = (h1 + i*h2) mod m
"""
import os, struct, sys
from lm import load, train

WORDS = 50000
BITS_PER_WORD = 12
HASHES = 8

def fnv1a(data: bytes) -> int:
    h = 0xCBF29CE484222325
    for b in data:
        h ^= b
        h = (h * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    return h

def bloom(words):
    m = (len(words) * BITS_PER_WORD + 7) // 8 * 8
    bits = bytearray(m // 8)
    for w in words:
        h = fnv1a(w.encode("utf-8"))
        h1, h2 = h & 0xFFFFFFFF, (h >> 32) | 1
        for i in range(HASHES):
            b = (h1 + i * h2) % m
            bits[b // 8] |= 1 << (b % 8)
    return struct.pack("<IB", m, HASHES) + bytes(bits)

def main():
    src = sys.argv[1]
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    os.makedirs(out, exist_ok=True)
    for lang in ("en", "uk", "ru"):
        words = load(lang, os.path.join(src, f"{lang}_full.txt"))[:WORDS]
        open(os.path.join(out, f"{lang}.tri"), "wb").write(train(lang, words))
        open(os.path.join(out, f"{lang}.bloom"), "wb").write(bloom([w for w, _ in words]))
        print(lang, len(words), "words")

if __name__ == "__main__":
    main()
