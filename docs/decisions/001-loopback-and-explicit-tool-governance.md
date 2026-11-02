# ADR 001: Numeric Loopback Binding, Cloud-Model Blocking, and Single-Use Tool Approvals

- **Status**: Accepted
- **Date**: 2026-11-02

## Context

Local AI assistants frequently fail their privacy promises in three ways:
1. Binding local HTTP servers to `0.0.0.0` or skipping `Host`/`Origin`/CSRF verification, allowing any website visited in the user's browser to invoke local tools or exfiltrate notes via cross-site requests or DNS rebinding.
2. Forwarding prompts to remote cloud aliases registered inside a local model runner without the user realizing data left the machine.
3. Allowing language models to execute side effects (saving memory, indexing workspace files, running commands) autonomously when prompt-injected by untrusted text or retrieved documents.

## Decision

1. **Numeric Loopback Only (`127.0.0.1`)**:
   - All upstream inference endpoints (`OLLAMA_URL`, `WHISPER_URL`) are validated by `loopbackEndpoint()` in `server/config.ts` to require `http://127.0.0.1` without credentials, query parameters, or HTTP redirects (`redirect: 'error'`).
   - All incoming HTTP requests must match the expected `Host` (`127.0.0.1:<port>` or `localhost:<port>`), pass `Origin` and `Sec-Fetch-Site` checks, and supply both an `HttpOnly` `SameSite=Strict` session cookie and a matching `x-auralis-csrf` header on every mutating route.

2. **Two-Stage Local Weight Verification**:
   - Before sending any chat prompt to Ollama, `Ollama.assertLocal()` checks both `/api/tags` and `/api/show` metadata, blocking any model name or manifest with `remote_host`, `remote_model`, `cloud` tags, empty `model_info`, or weights exceeding `8 GiB`.

3. **Untrusted Model Output & Single-Use Human Proposals**:
   - Model outputs and retrieved knowledge chunks are treated strictly as untrusted data.
   - Pure, bounded read-only calculations (`calculate`) may execute when `toolsEnabled` is active, but any persistent mutation (`note.save`, `knowledge.index` from workspace inspection) creates a short-lived (5-minute), session-bound proposal in `server/proposals.ts`.
   - Consuming a proposal deletes it *before* executing the side effect so network retries or race conditions cannot replay writes.

4. **Redacted Diagnostic Audit Log**:
   - `Store.audit()` records action types, timestamps, and non-sensitive identifiers (`note.saved`, `knowledge.indexed`, `knowledge.searched`, `workspace.inspected`) while never logging user prompts, note contents, document text, search queries, or audio bytes.

## Consequences

- **Positive**: Browser-origin attacks, accidental cloud model routing, and prompt-injected persistent writes are blocked at the Node policy boundary regardless of model behavior.
- **Negative / Trade-off**: Users must explicitly click **Save memory** or **Index document** to approve proposed writes, and remote inference servers on a LAN cannot be used without modifying `loopbackEndpoint()`.
