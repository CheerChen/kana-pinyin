// Bilingual REPL — auto-detect pinyin (Chinese) vs romaji (Japanese).
//
// Architecture:
//   Input → Language detector → { Chinese dict pipeline | Japanese karukan pipeline }
//
// Usage:
//   deno run -A src/repl.ts [karukan-imserver-path]
//
// Commands:
//   <roman>    type pinyin or romaji, Enter to get candidates
//   <number>   select candidate by index
//   Enter      select top candidate (same as '0')
//   c          clear buffer
//   q          quit

import path from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline";
import { detectLanguage, tryRomajiSplit } from "./detector/lang_detect.ts";
import { loadDictionaries, lookupCandidates, pinyinToSyllables } from "./pinyin/dict_lookup.ts";
import { KarukanClient, convertJapanese } from "./japanese/karukan_client.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
    // --- Load Chinese dictionaries ---
    console.log("Loading Chinese dictionaries...");
    const dictDir = path.join(__dirname, "../dicts");
    loadDictionaries(dictDir);

    // --- Start karukan-imserver ---
    const karukanBin = Deno.args[0] ??
        "../karukan/target/release/karukan-imserver";
    console.log("\nStarting karukan-imserver:", karukanBin);
    let karukan: KarukanClient | null = null;
    try {
        karukan = new KarukanClient(karukanBin);
        const modelName = await karukan.init();
        console.log(`  karukan model: ${modelName}`);
        console.log("  karukan ready");
    } catch (e) {
        console.log("  karukan failed to start:", e);
        console.log("  Japanese input will not be available");
    }

    // --- REPL state ---
    const state = {
        committedText: "",
        pendingCandidates: [] as string[],
        pendingLang: null as "zh" | "ja" | null,
        pendingKarukan: null as KarukanClient | null,
    };

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: "\n> ",
    });

    console.log("\n" + "=".repeat(60));
    console.log("kana-pinyin — bilingual IME demo");
    console.log("=".repeat(60));
    console.log("Type any roman string and Enter. Language is auto-detected.");
    console.log("Commands: <number> select | Enter=top | c=clear | q=quit");

    rl.prompt();

    // Queue-based processing: ensure only one line is processed at a time
    // (needed because Japanese conversion is async and piped input may
    // deliver lines faster than the model can respond)
    let processing = false;
    let processQueueResolve: (() => void) | null = null;
    const queue: string[] = [];

    rl.on("line", (input: string) => {
        queue.push(input);
        processQueue();
    });

    async function processQueue() {
        if (processing) return;
        processing = true;
        while (queue.length > 0) {
            const input = queue.shift()!;
            try {
                await processLine(input);
            } catch (e) {
                console.log(`  (error: ${e})`);
            }
            if (!rl.closed) rl.prompt();
        }
        processing = false;
        if (processQueueResolve) {
            processQueueResolve();
            processQueueResolve = null;
        }
    }

    function waitForQueue(): Promise<void> {
        if (!processing && queue.length === 0) return Promise.resolve();
        return new Promise((resolve) => { processQueueResolve = resolve; });
    }

    async function processLine(input: string) {
        const trimmed = input.trim();

        if (trimmed === "q" || trimmed === "quit") {
            if (karukan) karukan.close();
            rl.close();
            return;
        }

        if (trimmed === "c" || trimmed === "clear") {
            state.committedText = "";
            state.pendingCandidates = [];
            state.pendingLang = null;
            if (karukan) await karukan.reset();
            console.log("  (buffer cleared)");
            return;
        }

        // Empty input = select top candidate
        if (trimmed === "") {
            if (state.pendingCandidates.length > 0 && state.pendingLang) {
                if (state.pendingLang === "ja" && state.pendingKarukan) {
                    const result = await state.pendingKarukan.selectCandidate(0);
                    for (const action of result.actions || []) {
                        if (action.type === "commit") {
                            state.committedText += action.text;
                        }
                    }
                } else {
                    state.committedText += state.pendingCandidates[0];
                }
                console.log(`  >> Committed: ${state.pendingCandidates[0]}`);
                console.log(`  Buffer: ${state.committedText}`);
            }
            state.pendingCandidates = [];
            state.pendingLang = null;
            return;
        }

        // Number input = select candidate by index
        if (/^\d+$/.test(trimmed)) {
            const idx = parseInt(trimmed, 10);
            if (state.pendingCandidates.length > 0 && idx < state.pendingCandidates.length && state.pendingLang) {
                if (state.pendingLang === "ja" && state.pendingKarukan) {
                    const result = await state.pendingKarukan.selectCandidate(idx);
                    for (const action of result.actions || []) {
                        if (action.type === "commit") {
                            state.committedText += action.text;
                        }
                    }
                } else {
                    state.committedText += state.pendingCandidates[idx];
                }
                console.log(`  >> Committed: ${state.pendingCandidates[idx]}`);
                console.log(`  Buffer: ${state.committedText}`);
            }
            state.pendingCandidates = [];
            state.pendingLang = null;
            return;
        }

        // Detect language and route to the appropriate pipeline
        const lang = detectLanguage(trimmed);
        console.log(`  Detected: ${lang === "zh" ? "Chinese (pinyin)" : lang === "ja" ? "Japanese (romaji)" : "unknown"}`);

        if (lang === "zh") {
            const syllables = pinyinToSyllables(trimmed);
            console.log(`  Pinyin: ${syllables.join(" ")}`);

            const candidates = lookupCandidates(syllables);
            if (candidates.length === 0) {
                console.log("  (no candidates found)");
            } else {
                state.pendingCandidates = candidates.slice(0, 10).map((c) => c.word);
                state.pendingLang = "zh";
                state.pendingKarukan = null;
                console.log("  Candidates:");
                for (let i = 0; i < state.pendingCandidates.length; i++) {
                    console.log(`    ${i}: ${state.pendingCandidates[i]}`);
                }
            }
        } else if (lang === "ja" && karukan) {
            const romajiSyllables = tryRomajiSplit(trimmed);
            console.log(`  Romaji: ${romajiSyllables?.join(" ")}`);

            try {
                const candidates = await convertJapanese(trimmed, karukan);
                if (candidates.length === 0) {
                    console.log("  (no candidates from karukan)");
                } else {
                    state.pendingCandidates = candidates.slice(0, 10);
                    state.pendingLang = "ja";
                    state.pendingKarukan = karukan;
                    console.log("  Candidates:");
                    for (let i = 0; i < state.pendingCandidates.length; i++) {
                        console.log(`    ${i}: ${state.pendingCandidates[i]}`);
                    }
                }
            } catch (e) {
                console.log(`  (karukan error: ${e})`);
            }
        } else if (lang === "ja" && !karukan) {
            console.log("  (karukan not available — cannot process Japanese)");
        } else {
            console.log("  (could not detect language — try again)");
        }
    }

    rl.on("close", async () => {
        await waitForQueue();
        if (karukan) karukan.close();
        console.log(`\nFinal text: ${state.committedText}`);
        process.exit(0);
    });
}

main();
