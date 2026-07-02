// Japanese kana-kanji conversion via karukan-imserver (JSON-RPC over stdio).
//
// karukan-imserver is a stdio JSON-RPC 2.0 server that wraps the karukan
// neural IME engine. We spawn it as a child process, feed romaji one key
// at a time, then send Space to trigger conversion and get candidates.

export type KarukanCandidate = {
    text: string;
    description?: string;
};

export class KarukanClient {
    private proc: Deno.ChildProcess;
    private stdin: WritableStreamDefaultWriter;
    private stdoutReader: ReadableStreamDefaultReader;
    private requestId = 0;
    private resolvers = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();

    constructor(binPath: string) {
        const cmd = new Deno.Command(binPath, {
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        });
        this.proc = cmd.spawn();
        this.stdin = this.proc.stdin.getWriter();
        this.stdoutReader = this.proc.stdout.getReader();

        this.readLoop();
        this.readStderr();
    }

    private async readStderr() {
        const reader = this.proc.stderr.getReader();
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                const text = decoder.decode(value, { stream: true });
                if (text.includes("ERROR") || text.includes("error") || text.includes("WARN")) {
                    process.stderr.write(`[karukan] ${text}`);
                }
            }
        } catch { /* ignore */ }
    }

    private async readLoop() {
        const decoder = new TextDecoder();
        let buffer = "";
        try {
            while (true) {
                const { done, value } = await this.stdoutReader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const msg = JSON.parse(line);
                        if (msg.id !== undefined && msg.id !== null) {
                            const resolver = this.resolvers.get(msg.id);
                            if (resolver) {
                                this.resolvers.delete(msg.id);
                                resolver.resolve(msg);
                            }
                        }
                    } catch { /* ignore parse errors */ }
                }
            }
        } catch { /* ignore */ }
    }

    async call(method: string, params: any = {}): Promise<any> {
        const id = ++this.requestId;
        const req = JSON.stringify({ jsonrpc: "2.0", id, method, params });

        const responsePromise = new Promise<any>((resolve, reject) => {
            this.resolvers.set(id, { resolve, reject });
            setTimeout(() => {
                if (this.resolvers.has(id)) {
                    this.resolvers.delete(id);
                    reject(new Error(`Timeout waiting for ${method} response (id=${id})`));
                }
            }, 60000);
        });

        await this.stdin.write(new TextEncoder().encode(req + "\n"));
        const resp = await responsePromise;
        if (resp.error) throw new Error(`${method}: ${resp.error.message}`);
        return resp.result;
    }

    async init(): Promise<string> {
        const result = await this.call("init", {});
        return result.model_name;
    }

    async processKey(keysym: number): Promise<any> {
        return await this.call("process_key", { keysym, modifiers: {}, is_release: false });
    }

    async selectCandidate(pageIndex: number): Promise<any> {
        return await this.call("select_candidate", { page_index: pageIndex });
    }

    async commit(): Promise<any> {
        return await this.call("commit", {});
    }

    async reset(): Promise<void> {
        await this.call("reset", {});
    }

    close() {
        try { this.stdin.close(); } catch { /* ignore */ }
        try { this.proc.kill(); } catch { /* ignore */ }
    }
}

// Feed a romaji string to karukan, trigger conversion, get candidates.
// Each character is sent as a key press; Space triggers kana-kanji conversion.
export async function convertJapanese(romaji: string, karukan: KarukanClient): Promise<string[]> {
    for (const ch of romaji) {
        const keysym = ch.charCodeAt(0);
        await karukan.processKey(keysym);
    }

    // Space triggers conversion (same as karukan's normal UX)
    const spaceResult = await karukan.processKey(0x0020);

    const candidates: string[] = [];
    for (const action of spaceResult.actions || []) {
        if (action.type === "show_candidates") {
            for (const c of action.candidates || []) {
                candidates.push(c.text);
            }
        }
    }

    // Fallback: use preedit text if no candidates
    if (candidates.length === 0) {
        for (const action of spaceResult.actions || []) {
            if (action.type === "update_preedit") {
                candidates.push(action.text);
            }
        }
    }

    return candidates;
}
