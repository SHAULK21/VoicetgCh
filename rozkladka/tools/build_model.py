"""Builds the language data embedded into rozkladka.exe (data/*.tri, data/*.bloom).

Source: word frequency lists from https://github.com/hermitdave/FrequencyWords
(OpenSubtitles 2018). Usage:

    python3 build_model.py <dir with en_full.txt uk_full.txt ru_full.txt>

*.tri   - letter trigram model: n^3 bytes, q = round(-log2 P(c | a b) * 8), alphabet in lm.ALPHA
*.bloom - Bloom filter of the most frequent words:
          u32 LE bit count, u8 hash count, then the bit array (LSB first).
          Hash: FNV-1a 64 over UTF-8; h1 = low 32 bits, h2 = high 32 bits | 1; bit_i = (h1 + i*h2) mod m
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
