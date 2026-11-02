# Known Limitations & Honest Trade-offs

Auralis is engineered for a 16 GB Apple Silicon Mac running local weights via Ollama. Every architectural choice involves deliberate trade-offs that operators and contributors should understand.

## 1. Local Hardware & Memory Constraints

- **8 GiB Model Weight Guard**: `server/provider.ts` filters out models whose reported weight size exceeds 8 GiB (`MAX_MODEL_BYTES`) so a 16 GB unified-memory Mac retains headroom for macOS, the browser, KV cache, and optional voice transcription. Users on 32 GB+ Macs who wish to run larger models must adjust `MAX_MODEL_BYTES`.
- **Single Active Inference Slot**: `server/app.ts` admits one active chat or transcription request at a time (`429 Too Many Requests` on concurrent calls). Running parallel local LLM generations on shared unified memory degrades token throughput and causes swap pressure.
- **Session-Only Chat History**: Conversation turns stay in browser memory by default and reset on page reload unless exported as JSON or explicitly saved to notes.

## 2. Retrieval & Knowledge Base Trade-offs

- **Lexical + Phrase Hybrid (No Dense Vector Embeddings Yet)**: `server/knowledge.ts` uses deterministic line-aware chunking and a hybrid BM25 + token-overlap + exact-phrase + heading-boost scoring engine. It requires zero external embedding models or background GPU daemons and runs in `< 1 ms` for typical personal corpora (up to 200 documents, 64 KB each). However, pure lexical/phrase retrieval will miss synonyms when zero query tokens overlap with the target document.
- **Context Window Budget**: Enabling `useKnowledge: true` injects up to 4 top-ranked chunks into the system prompt. Under the `fast` profile (`2,048` tokens), long multi-turn conversations combined with retrieved chunks may truncate earlier conversation turns inside Ollama.

## 3. Security & Process Isolation Boundaries

- **Same-User Process Boundary**: Loopback binding (`127.0.0.1`), `Host`/`Origin` checks, `HttpOnly` `SameSite=Strict` cookies, and CSRF tokens protect against browser-origin and DNS-rebinding attacks. They do **not** protect against malware or another native process running under the same macOS user account.
- **Plaintext Local Storage**: Notes (`notes.json`) and indexed documents (`knowledge.json`) are stored in `~/.auralis` (or `AURALIS_DATA_DIR`) with `0600` owner-only permissions. They are not encrypted by an application passphrase; rely on macOS FileVault full-disk encryption.
- **Browser Speech Synthesis**: Spoken responses use `window.speechSynthesis` filtered to voices reporting `localService === true`. That flag is provided by the browser/OS and is not packet-inspected by Auralis.
