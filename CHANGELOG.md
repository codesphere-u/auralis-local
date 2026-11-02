# Changelog

All notable changes to Auralis are documented in this file.

## [0.2.0] - 2026-11-02

### Added
- **Local Document Knowledge Base & Hybrid Retrieval (`server/knowledge.ts`)**:
  - Deterministic line-aware chunking with Markdown (`#`–`####`) and source-code (`function`, `class`, `def`, `interface`) heading preservation.
  - Hybrid BM25 + token-coverage + exact-phrase scoring engine returning ranked citations with file paths and 1-based line ranges (`#Lstart-Lend`).
  - Protected API routes: `GET /api/knowledge`, `POST /api/knowledge/documents`, `POST /api/knowledge/search`, and `DELETE /api/knowledge/documents/:id`.
  - Optional `useKnowledge: true` grounding in `POST /api/chat`, emitting a `citations` NDJSON stream event before token generation so the interface displays exact source provenance.
- **Guarded Workspace Inspector (`server/workspace.ts`)**:
  - Read-only, path-sanitized workspace inspection (`GET /api/workspace/files`, `POST /api/workspace/inspect`) that blocks path traversal (`..`), absolute paths, symbolic links, dotfiles (`.env`, `.git`, `.ssh`), `node_modules`, and credential/private-key filenames.
  - Single-use, session-bound human approval (`knowledge.index` proposal) required before indexing an inspected workspace file into the knowledge base.
- **Reproducible Local Pipeline Benchmark & Telemetry (`scripts/benchmark.ts`, `src/App.tsx`)**:
  - Deterministic local pipeline benchmark measuring document indexing throughput, BM25 retrieval latency (P50/P95/max), NDJSON stream framing throughput, calculator evaluation speed, and Node RSS delta alongside optional live Ollama inference trials.
  - Dedicated **Knowledge base** view and live **System & Benchmark Telemetry** panel in the React interface.
- **Documentation & Architecture Records**:
  - Added `docs/limitations.md`, `docs/decisions/001-loopback-and-explicit-tool-governance.md`, and `CODE_OF_CONDUCT.md`.

## [0.1.0] - 2026-10-31

### Added
- Streamed local chat with Ollama (`127.0.0.1`), model weight-size guard (`≤ 8 GiB`), cloud-alias blocking, and `fast` (`2,048` ctx) / `balanced` (`4,096` ctx) profiles.
- Bounded arithmetic calculator (`server/calculator.ts`) and single-use approval-gated memory notes (`server/proposals.ts`, `server/store.ts`).
- Dedicated Voice Room with pause-to-send turn detection, mono 16 kHz PCM WAV encoding, optional Apple Silicon MLX / `whisper.cpp` loopback transcription, and sentence-streamed local speech synthesis.
- Loopback Host/Origin verification, `HttpOnly` `SameSite=Strict` session cookies, CSRF tokens, and content-redacted audit logging.
