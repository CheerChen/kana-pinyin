// Language detector: classify a roman string as pinyin (Chinese) or romaji (Japanese).
//
// Strategy: try splitting with both syllable tables. The one that fully
// matches wins. When both match, use feature scoring (romaji-specific
// syllables like chi/tsu/shi vs pinyin-specific initials like zh/ch/sh).

import { keys_to_pinyin } from "../key_map/pinyin/keys_to_pinyin.ts";

// Romaji syllable set — covers Hepburn, Nihon-shiki, and Kunrei-shiki.
// karukan's romaji converter accepts all three romanization styles.
const romajiSyllables = new Set<string>([
    "a", "i", "u", "e", "o",
    "ka", "ki", "ku", "ke", "ko",
    // sa-row: Hepburn shi, Kunrei si
    "sa", "shi", "si", "su", "se", "so",
    // ta-row: Hepburn chi/tsu, Kunrei ti/tu
    "ta", "chi", "ti", "tsu", "tu", "te", "to",
    "na", "ni", "nu", "ne", "no",
    // ha-row: Hepburn fu, Kunrei hu
    "ha", "hi", "fu", "hu", "he", "ho",
    "ma", "mi", "mu", "me", "mo",
    "ya", "yu", "yo",
    "ra", "ri", "ru", "re", "ro",
    "wa", "wo", "n",
    "ga", "gi", "gu", "ge", "go",
    // za-row: Hepburn ji/zu, Kunrei zi/zu; also du/di for づ/ぢ
    "za", "ji", "zi", "zu", "ze", "zo",
    "da", "di", "du", "de", "do",
    "ba", "bi", "bu", "be", "bo",
    "pa", "pi", "pu", "pe", "po",
    // y-glides: Hepburn and Kunrei variants
    "kya", "kyu", "kyo",
    "sha", "shu", "sho", "sya", "syu", "syo",
    "cha", "chu", "cho", "tya", "tyu", "tyo",
    "nya", "nyu", "nyo",
    "hya", "hyu", "hyo",
    "mya", "myu", "myo",
    "rya", "ryu", "ryo",
    "gya", "gyu", "gyo",
    "ja", "ju", "jo", "zya", "zyu", "zyo",
    "bya", "byu", "byo",
    "pya", "pyu", "pyo",
    "ye", "wi", "we",
]);

// Romaji-specific syllables that never appear in pinyin.
const romajiOnlySyllables = new Set([
    "chi", "tsu", "shi", "fu", "ji", "ja", "ju", "jo",
    "wa", "wo", "ti", "tu", "si", "hu", "zi", "di", "du",
    "kya", "kyu", "kyo", "sha", "shu", "sho", "sya", "syu", "syo",
    "cha", "chu", "cho", "tya", "tyu", "tyo",
    "nya", "nyu", "nyo", "hya", "hyu", "hyo",
    "mya", "myu", "myo", "rya", "ryu", "ryo",
    "gya", "gyu", "gyo", "zya", "zyu", "zyo",
    "bya", "byu", "byo", "pya", "pyu", "pyo",
]);

export type Language = "zh" | "ja" | "unknown";

// Try to split input as romaji syllables.
// Returns array of syllables if full match, null if not.
export function tryRomajiSplit(input: string): string[] | null {
    const lower = input.toLowerCase();
    const syllables: string[] = [];
    let i = 0;

    while (i < lower.length) {
        // Handle 'nn' → ん (double n is a valid romaji pattern)
        if (lower[i] === "n" && lower[i + 1] === "n") {
            syllables.push("n");
            i += 2;
            continue;
        }

        // Handle sokuon (double consonant): kk, ss, tt, pp, etc.
        // The first consonant becomes っ, the rest forms a syllable.
        const ch = lower[i];
        const next = lower[i + 1];
        if (ch === next && "kstpbgdzjcr".includes(ch)) {
            let matched = false;
            for (let len = 4; len >= 1; len--) {
                const sub = lower.slice(i + 1, i + 1 + len);
                if (romajiSyllables.has(sub)) {
                    syllables.push("tsu"); // sokuon marker
                    syllables.push(sub);
                    i += 1 + len;
                    matched = true;
                    break;
                }
            }
            if (!matched) return null;
            continue;
        }

        // Try longest match (4 → 1 chars)
        let matched = false;
        for (let len = Math.min(4, lower.length - i); len >= 1; len--) {
            const sub = lower.slice(i, i + len);
            if (romajiSyllables.has(sub)) {
                syllables.push(sub);
                i += len;
                matched = true;
                break;
            }
        }
        if (!matched) return null;
    }

    return syllables;
}

// Try to split input as pinyin syllables using lime's keys_to_pinyin.
// Returns array of syllables if the split fully covers the input, null if not.
export function tryPinyinSplit(input: string): string[] | null {
    const result = keys_to_pinyin(input, {
        shuangpin: false,
        fuzzy: {
            initial: {
                c: "ch", z: "zh", s: "sh",
                ch: "c", zh: "z", sh: "s",
            },
            final: {
                an: "ang", ang: "an",
                en: "eng", eng: "en",
                in: "ing", ing: "in",
                uan: "uang", uang: "uan",
            },
        },
    });

    // Check if all input was consumed by summing the key lengths
    let consumed = 0;
    const syllables: string[] = [];
    for (const s of result) {
        const first = s[0];
        if (!first || first.ind === "*") continue;
        const keyLen = first.key.replace(/'/g, "").length;
        consumed += keyLen;
        syllables.push(first.ind);
    }

    if (syllables.length === 0) return null;
    // Must consume the entire input to be a valid pinyin split
    if (consumed !== input.length) return null;

    // Quality check: total pinyin length should be close to input length.
    // Garbage matches like k→kuang inflate pinyin far beyond the input.
    const totalPinyinLen = syllables.reduce((acc, s) => acc + s.length, 0);
    if (totalPinyinLen > input.length * 1.3) return null;

    return syllables;
}

// Detect language: returns "zh", "ja", or "unknown"
export function detectLanguage(input: string): Language {
    const lower = input.toLowerCase().trim();
    if (!lower || !/^[a-z]+$/.test(lower)) return "unknown";

    const pinyinSplit = tryPinyinSplit(lower);
    const romajiSplit = tryRomajiSplit(lower);

    const pinyinOk = pinyinSplit !== null;
    const romajiOk = romajiSplit !== null;

    if (pinyinOk && !romajiOk) return "zh";
    if (romajiOk && !pinyinOk) return "ja";
    if (pinyinOk && romajiSplit) {
        // Both match — use feature scoring
        let romajiScore = 0;
        let pinyinScore = 0;

        for (const s of romajiSplit) {
            if (romajiOnlySyllables.has(s)) romajiScore += 3;
        }
        if (pinyinSplit) {
            for (const s of pinyinSplit) {
                if (s.startsWith("zh") || s.startsWith("ch") || s.startsWith("sh")) pinyinScore += 2;
                if (s.endsWith("ng")) pinyinScore += 1;
                if (s.includes("q")) pinyinScore += 2;
                if (s.includes("v")) pinyinScore += 2;
            }
        }

        // 'n' alone is more common in romaji (ん)
        if (romajiSplit.filter((s) => s === "n").length > 0) romajiScore += 1;

        if (romajiScore > pinyinScore) return "ja";
        return "zh";
    }

    return "unknown";
}
