# Local API

The browser and API share an origin. Built mode uses `http://127.0.0.1:4317`; development normally uses Vite at `http://127.0.0.1:5173` with an API proxy. This API is designed for the local interface, not public internet access.

## Session and request protection

Call `GET /api/session` first. The response returns `{ "csrf": "…" }` and establishes an HttpOnly SameSite Strict session cookie. Preserve the cookie and send the returned value in the `x-auralis-csrf` header on mutations. Requests must satisfy server Host and Origin checks. Browser clients use same-origin credentials.

Tokens are ephemeral and should not be stored in a repository or transcript. Obtain a new session after restarting the server. A CSRF value is not a remote API key and does not make network exposure supported.

JSON mutations use `Content-Type: application/json`. Transcription uses `audio/wav`.

## `GET /api/health`

Returns application availability, the active model setting, eligible installed model names discovered from Ollama, transcription configuration, saved-note count, and latest observed audit-write health. Inventory excludes recognized remote / cloud models and models with reported weights larger than 8 GiB.

```json
{
  "status": "ok",
  "provider": { "connected": true, "models": ["qwen3.5:4b"] },
  "voice": { "configured": false },
  "memory": { "count": 0 },
  "audit": { "available": true },
  "activeModel": "qwen3.5:4b"
}
```

This example illustrates the schema. It is not a live result. A connected provider means discovery succeeded; it does not mean every listed model fits memory or supports tools. Voice configuration means an endpoint is configured, not that a real recording was successfully transcribed. `audit.available` reports whether the latest attempted audit write succeeded; it is not a continuous filesystem check.

## `POST /api/chat`

```json
{
  "model": "qwen3.5:4b",
  "profile": "fast",
  "toolsEnabled": true,
  "messages": [
    { "role": "user", "content": "What is 18 * 27?" }
  ]
}
```

Messages accept user and assistant roles. The client cannot supply a system role or arbitrary tool-result role. Profiles are `fast` and `balanced`.

The successful response is `application/x-ndjson`: one JSON object per line. Network chunks do not necessarily end on line boundaries; clients must buffer incomplete lines.

Event shapes:

```ts
{ type: 'token', text: string }
{ type: 'status', text: string }
{ type: 'citations', citations: Array<{
  chunkId: string,
  documentId: string,
  title: string,
  path: string,
  heading?: string,
  startLine: number,
  endLine: number,
  snippet: string,
  score: number,
  matchedTerms: string[]
}>, retrievalMs: number }
{ type: 'tool', name: string, result: string }
{ type: 'proposal', proposal: {
  id: string,
  tool: 'note.save' | 'knowledge.index',
  args: { title: string, content: string, path?: string, format?: string },
  expiresAt: number
} }
{ type: 'metrics', ttftMs: number | null, totalMs: number,
  outputTokens?: number, tokensPerSecond?: number }
{ type: 'error', message: string }
{ type: 'done' }
```

`expiresAt` is a Unix timestamp in milliseconds. A token event contains a text fragment, not necessarily a model tokenizer token. `ttftMs` is null when no text was emitted. Metrics use provider counters where available; do not derive token throughput from the number of token events.

Once streaming begins, an error may arrive as an event rather than an HTTP error status. Treat it as a failure even if the HTTP status was successful. A completed stream is not evidence that the answer is correct. Abort the fetch to cancel.

The application admits one active inference operation (chat or transcription). JSON bodies are bounded to 256 KiB. Chat accepts 1–40 messages, at most 16,000 characters per message and 64,000 characters total. Profiles constrain the model context separately; character limits are not token limits. Output generation is bounded to 1,024 tokens per model step, with at most four model steps and at most four tool calls per step. A pending note proposal ends that generation; approval writes the note without silently starting another chat.

## `GET /api/knowledge`

Returns `{ "documents": [...], "stats": { "documentCount": 0, "chunkCount": 0, "totalTokens": 0, "avgChunkTokens": 0 } }`. Document metadata includes `id`, `title`, `path`, `format`, `createdAt`, `chunkCount`, `tokenCount`, and `lineCount`.

## `POST /api/knowledge/documents`

Indexes a document (`.md`, `.txt`, `.json`, `.ts`, `.py`, `.js`, up to 64,000 characters, max 200 documents) into `knowledge.json` using deterministic line-aware chunking:

```json
{
  "title": "System Architecture",
  "path": "docs/architecture.md",
  "format": "md",
  "content": "# Architecture\nAuralis binds to 127.0.0.1."
}
```

## `POST /api/knowledge/search`

Queries the local hybrid BM25 + phrase scoring engine (`limit` 1–20, default 5) and returns `{ "citations": [...], "retrievalMs": 0.25, "stats": { ... } }`.

## `DELETE /api/knowledge/documents/:id`

Removes an indexed document and rebuilds the in-memory chunk index.

## `GET /api/workspace/files` and `POST /api/workspace/inspect`

`GET /api/workspace/files` lists readable non-hidden text/code files inside the workspace root. `POST /api/workspace/inspect` accepts `{ "path": "docs/setup.md", "proposeIndex": true }`, blocks `..`, symlinks, dotfiles, `node_modules`, and credential files, and optionally creates a single-use `knowledge.index` approval proposal.

## `GET /api/notes`

Returns `{ "notes": [...] }`. Each note has `id`, `title`, `content`, and `createdAt`. Notes are private user data; do not log the response.

Notes are explicitly saved content. Their presence does not imply an automatic retrieval or embedding system.

## `DELETE /api/notes/:id`

Deletes the named saved note. Requires session and CSRF protection. Update the memory view from the resulting state rather than assuming a deletion succeeded.

## `POST /api/proposals/:id`

```json
{ "approve": true }
```

Approves or rejects a pending tool proposal using the same session that received it. Returns `{ "result": "…" }` with a human-readable outcome. `approve: false` rejects it. Approval does not accept replacement tool arguments; users review the server-held arguments.

Proposals expire after five minutes and are single use. The server allows at most 100 pending proposals globally. A note title is limited to 120 characters and content to 8,000 characters. At most 500 notes are stored. Approval can fail if limits are reached, the session changed, the proposal expired, or it was already consumed.

## `GET /api/audit`

Returns `{ "events": [...] }`. Events have `id`, `at`, `action`, and `detail`. At most the latest 200 events are returned, newest first. The event data intentionally excludes chat text, note content, and audio. The on-disk log is reset when it exceeds approximately 1 MB; it is diagnostic history, not a durable compliance ledger. Treat usage metadata as private even when content is redacted.

## `POST /api/transcribe`

The request body is raw WAV audio, with `Content-Type: audio/wav`, a session cookie, and CSRF header. The server accepts at most 10 MiB. The browser recorder caps capture at 30 seconds and produces mono 16 kHz PCM WAV. The server checks size and the WAV signature; it does not independently validate the audio duration. The local transcription server must be configured separately.

The API wraps audio as a multipart file for the configured whisper.cpp `/inference` endpoint and returns `{ "text": "…" }`. The browser places the transcript in the draft for review; it never automatically submits that transcript as chat. Navigating away, hiding the page, or unmounting the recorder disposes of and discards an active capture. This endpoint does not intentionally save a recording.

## Errors

Requests can fail for invalid input, missing or expired sessions, rejected origins, unavailable services, provider errors, concurrency limits, timeouts, or unknown routes. Display the returned error message without interpreting it as executable markup. Do not automatically retry mutations such as approving a write: first inspect the state, because a lost response does not prove the operation was not applied.

Before streaming starts, errors use `{ "message": "…" }`. Common statuses are 400 for malformed or invalid input, 401 for an absent / expired session, 403 for rejected request verification, 404 for a missing route or note, 409 for unavailable approval, 413 for a body limit, 415 for the wrong content type, 429 for concurrent inference or a session limit, and 503 for unconfigured local voice. A failed transcription provider can return 502. Chat errors after stream headers use the error event described above.

Sessions last eight hours and are kept only in server memory, with at most 100 active sessions. Chat generation has a three-minute deadline; transcription has a two-minute upstream deadline.

## Configuration

Set environment variables before starting the server. `.env` is a reference example and is **not automatically loaded**.

- `AURALIS_MODEL`: initial model; default `qwen3.5:4b`.
- `OLLAMA_URL`: numeric loopback HTTP origin; default `http://127.0.0.1:11434`. No path, credentials, query, or fragment.
- `WHISPER_URL`: optional numeric loopback HTTP inference endpoint, for example `http://127.0.0.1:8080/inference`.
- `AURALIS_DATA_DIR`: application data directory; default `~/.auralis`.
- `AURALIS_PORT`: API port; default `4317`, accepted range 1024–65535.
- `AURALIS_DEV`: set to `1` by the development command to permit the local Vite origin.

Inference endpoints require `http:` with hostname exactly `127.0.0.1`. Remote addresses, named hosts including `localhost`, embedded credentials, queries, and fragments are rejected. Endpoint configuration is operator-controlled and cannot be supplied by the model.

## Voice conversation profile

`POST /api/chat` accepts optional `mode: "voice"` (default `"chat"`). Voice mode forces context 2,048, output budget 192 tokens per step and disables tool definitions and execution regardless of client `toolsEnabled`. It requests one to three short spoken sentences. The NDJSON event contract is unchanged.
