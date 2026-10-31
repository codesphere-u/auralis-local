# Privacy and security model

## Intended use

One person runs Auralis on their own Mac as an ordinary local account. The interface, API, model service, and optional transcription service use loopback. The application is not a multi-user server and should not be placed behind a public tunnel, bound to a LAN interface, or exposed as an internet API.

The current implementation prioritizes a narrow capability surface and understandable approvals. It has not received an independent security audit.

## Data flow

During normal chat, text moves from the local browser to the local Node service and Ollama. During explicitly started recording, audio moves to the Node service and the configured local transcription service. Speech output uses voices the browser marks as local. There is no application analytics or automatic cloud inference fallback.

A loopback Ollama address alone is insufficient: Ollama can also proxy cloud models. Auralis filters inventory entries with cloud name markers or nonempty `remote_host` / `remote_model` fields. Before every model request, it verifies the selected name against the filtered installed inventory, requests `/api/show`, rejects remote metadata, and requires nonempty `model_info` describing downloaded weights. Missing or unverifiable metadata fails closed. This policy relies on truthful behavior from the separately installed local runtime; a compromised runtime remains outside the application boundary.

The provider also filters inventory entries whose reported weight size exceeds an 8 GiB budget and rechecks inventory before generation. This prevents the installed 18 GB model from appearing as a suitable choice on the target 16 GB Mac. Missing size metadata is not a memory estimate. Weight size is not total runtime memory: context/cache, allocations, the browser, speech services, and macOS still need headroom. The size guard is a practical admission limit, not a guarantee of low memory pressure.

Installing dependencies, downloading models, checking upstream releases, or opening documentation can use the internet. The model runtime, browser, and operating system have their own settings. “Local-first” describes Auralis's application data path, not a claim that the entire computer makes no network requests.

## What is stored

- Current conversation: browser memory only by default.
- Notes: user-approved title and content in the application data directory.
- Audit: event metadata with chat / audio content omitted.
- Exports: only when the user explicitly creates one.
- Audio: forwarded for transcription; Auralis does not intentionally retain a recording file.

Notes are plaintext. Owner-only filesystem modes are access control, not encryption. Secure deletion cannot be guaranteed on SSDs, backups, or snapshots. Runtime and operating system logs may exist outside Auralis's control.

## Threats addressed

### An unrelated website tries to control localhost

The server validates the Host header and request origin, does not offer permissive CORS, and requires a session / CSRF value for writes. SameSite Strict cookies reduce cross-site credential attachment. These checks must cover denial paths in tests. Do not weaken them to make a remote preview work.

### Model output requests an unsafe action

The model cannot execute text. Tool names and arguments pass server validation. The calculator has a restricted grammar; it is not `eval`. Note saving requires a short-lived, single-use proposal and explicit user approval of the exact content. Unknown tools are rejected. There is no shell, arbitrary path, arbitrary URL, or package installation tool.

### A prompt tells the assistant to ignore policy

Policy does not reside only in a system prompt. Server controls decide whether a call is permitted. Retrieved or model-generated text never supplies consent. Users must still inspect a proposed note for misleading or sensitive content; approval UI cannot establish factual correctness.

### Requests consume excessive resources

Input bounds, output budgets, deadlines, and a single generation limit reduce accidental overload. They do not reserve RAM for macOS or prevent a selected model from using too much memory. Users retain control of installed model sizes and other running applications.

### Data leaks through audit events

Audit records intentionally omit prompts, generated text, note content, and audio. New events need a redaction review. Diagnostic errors should not reflect upstream response bodies or secrets into logs. Metadata can still reveal usage patterns.

Audit writes are best effort. If appending an audit event fails after an approved note has been stored, the note operation remains successful and single-use approval is still consumed; the app must not encourage a retry that duplicates a completed write. `/api/health` exposes `audit.available`, which becomes false after an audit write failure and true after a later successful audit write. This is the latest observed write health, not a continuous filesystem check. The UI reports degraded auditing. The bounded diagnostic log is not a durable compliance record.

## Residual risks

- A process running as the same macOS user can often read application data, communicate with local services, or observe the browser. Auralis is not an operating system security boundary.
- A malicious browser extension, compromised dependency, browser exploit, or compromised model service can bypass assumptions above.
- Ollama and whisper.cpp are separate services with their own HTTP interfaces and security posture. Auralis cannot authenticate or constrain a request that bypasses it.
- Browser local-voice metadata is a practical selection control, not independent verification of speech engine implementation.
- Language models can fabricate facts or follow malicious instructions within text. Tool restrictions reduce side effects; they do not make responses reliable advice.
- Local HTTP uses loopback rather than TLS. It does not provide multi-user, cross-device transport security.
- There is no encrypted credential vault, native application sandbox, signed app bundle, or hardened updater in this release.

## Adding capabilities safely

Before adding a tool, document its inputs, side effects, output, timeout, approval policy, filesystem scope, network scope, and failure behavior. A write approval must name concrete arguments, expire, and be consumed once. Provider endpoints must remain application configuration rather than model-controlled destinations.

Keep private fixtures and user data out of commits. For vulnerability reports use the route in [SECURITY.md](../SECURITY.md).
