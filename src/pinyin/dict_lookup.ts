// Chinese pinyin-to-hanzi conversion via RIME dictionaries.
//
// Loads word and character dictionaries from RIME dict files (format:
// `word<TAB>pinyin<TAB>freq`), then uses DP segmentation to find the
// best word combination matching a given pinyin syllable sequence.

import { keys_to_pinyin } from "../key_map/pinyin/keys_to_pinyin.ts";

export type DictEntry = { word: string; pinyin: string; freq: number };

const dictByPinyin = new Map<string, DictEntry[]>();
const charByPinyin = new Map<string, DictEntry[]>();

// Parse a RIME dict YAML file. Format: word<TAB>pinyin<TAB>freq
export function parseDictYaml(filePath: string): DictEntry[] {
    const text = Deno.readTextFileSync(filePath);
    const entries: DictEntry[] = [];
    let inHeader = true;
    for (const line of text.split("\n")) {
        if (inHeader) {
            if (line.startsWith("#") || line.trim() === "" || line.includes(": ")) continue;
            inHeader = false;
        }
        if (line.startsWith("#")) continue;
        const parts = line.split("\t");
        if (parts.length < 2) continue;
        const word = parts[0].trim();
        const pinyin = parts[1].trim();
        const freq = parts.length > 2 ? parseInt(parts[2].trim(), 10) || 1 : 1;
        if (!word || !pinyin) continue;
        entries.push({ word, pinyin, freq });
    }
    return entries;
}

// Index entries by pinyin key into the given map.
export function indexEntries(entries: DictEntry[], isCharDict: boolean): void {
    const target = isCharDict ? charByPinyin : dictByPinyin;
    for (const e of entries) {
        let list = target.get(e.pinyin);
        if (!list) { list = []; target.set(e.pinyin, list); }
        list.push(e);
    }
}

// Load all dictionaries from a directory.
export function loadDictionaries(dictDir: string): void {
    const wordDicts = ["base.dict.yaml", "ext.dict.yaml", "tencent.dict.yaml"];
    const charDicts = ["8105.dict.yaml"];

    for (const file of wordDicts) {
        try {
            const entries = parseDictYaml(`${dictDir}/${file}`);
            indexEntries(entries, false);
            console.log(`  ${file}: ${entries.length} entries`);
        } catch (e) {
            console.log(`  ${file}: skipped (${e})`);
        }
    }
    for (const file of charDicts) {
        try {
            const entries = parseDictYaml(`${dictDir}/${file}`);
            indexEntries(entries, true);
            console.log(`  ${file}: ${entries.length} entries (char dict)`);
        } catch (e) {
            console.log(`  ${file}: skipped (${e})`);
        }
    }
}

// RIME dictionaries use 'v' for 'ü': lv=lü, nv=nü.
// Users type 'lu'/'nu' — generate all variants for fuzzy matching.
function pinyinVariants(py: string): string[] {
    const p = py.toLowerCase().trim();
    const variants = new Set<string>([p]);
    if (p === "lu") { variants.add("lv"); variants.add("lü"); }
    if (p === "lv") { variants.add("lu"); variants.add("lü"); }
    if (p === "lü") { variants.add("lu"); variants.add("lv"); }
    if (p === "nu") { variants.add("nv"); variants.add("nü"); }
    if (p === "nv") { variants.add("nu"); variants.add("nü"); }
    if (p === "nü") { variants.add("nu"); variants.add("nv"); }
    return Array.from(variants);
}

// Lookup syllables in the dictionary, trying all pinyin variants.
function dictLookup(syllables: string[], isChar: boolean): DictEntry[] {
    const target = isChar ? charByPinyin : dictByPinyin;
    const results: DictEntry[] = [];
    const variantLists = syllables.map(pinyinVariants);
    function combine(idx: number, current: string[]) {
        if (idx === variantLists.length) {
            const key = current.join(" ");
            const matches = target.get(key);
            if (matches) results.push(...matches);
            return;
        }
        for (const v of variantLists[idx]) {
            current.push(v);
            combine(idx + 1, current);
            current.pop();
        }
    }
    combine(0, []);
    return results;
}

// DP segmentation: try all ways to split syllables into dictionary words.
// Scoring: fewer segments (longer word matches) wins; ties broken by frequency.
export function lookupCandidates(syllables: string[]): DictEntry[] {
    const results: DictEntry[] = [];
    const seen = new Set<string>();
    type Seg = DictEntry[];
    const memo = new Map<number, Seg[]>();

    function solve(start: number): Seg[] {
        if (memo.has(start)) return memo.get(start)!;
        if (start === syllables.length) return [[]];
        const segs: Seg[] = [];
        for (let len = 1; len <= syllables.length - start; len++) {
            const subSyllables = syllables.slice(start, start + len);
            const wordMatches = dictLookup(subSyllables, false);
            if (wordMatches.length === 0) continue;
            const restSegs = solve(start + len);
            if (restSegs.length === 0) continue;
            for (const word of wordMatches.slice(0, 8)) {
                for (const restSeg of restSegs.slice(0, 5)) {
                    segs.push([word, ...restSeg]);
                }
            }
        }
        // Fallback: single char per syllable if no word match
        if (segs.length === 0) {
            const charMatches = dictLookup([syllables[start]], true);
            if (charMatches.length > 0) {
                const restSegs = solve(start + 1);
                if (restSegs.length > 0) {
                    for (const ch of charMatches.slice(0, 3)) {
                        for (const restSeg of restSegs.slice(0, 3)) {
                            segs.push([ch, ...restSeg]);
                        }
                    }
                } else if (start + 1 === syllables.length) {
                    for (const ch of charMatches.slice(0, 3)) {
                        segs.push([ch]);
                    }
                }
            }
        }
        memo.set(start, segs);
        return segs;
    }

    const allSegs = solve(0);
    for (const seg of allSegs.slice(0, 50)) {
        if (seg.length === 0) continue;
        const word = seg.map((s) => s.word).join("");
        const pinyin = seg.map((s) => s.pinyin).join(" ");
        const segCount = seg.length;
        const totalFreq = seg.reduce((acc, s) => acc + Math.log(1 + s.freq), 0);
        // Fewer segments = much better (longer word matches preferred)
        const score = -segCount * 10000 + totalFreq;
        if (!seen.has(word)) {
            seen.add(word);
            results.push({ word, pinyin, freq: Math.floor(score * 1000) });
        }
    }
    results.sort((a, b) => b.freq - a.freq);
    return results;
}

// Convert a raw pinyin string to syllables using lime's keys_to_pinyin.
export function pinyinToSyllables(input: string): string[] {
    const result = keys_to_pinyin(input, {
        shuangpin: false,
        fuzzy: {
            initial: { c: "ch", z: "zh", s: "sh", ch: "c", zh: "z", sh: "s" },
            final: { an: "ang", ang: "an", en: "eng", eng: "en", in: "ing", ing: "in", uan: "uang", uang: "uan" },
        },
    });
    return result
        .map((s) => s[0]?.ind)
        .filter((s): s is string => !!s && s !== "*");
}
