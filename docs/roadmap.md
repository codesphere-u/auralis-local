# Scope and roadmap

Auralis is a focused original local assistant, not a replacement for every capability in OpenJarvis. Its initial improvements are product choices: a coherent animated interface, visible privacy boundaries, deliberate memory, low setup surface, bounded local execution, and reviewable tool writes. Overall superiority requires comparative evidence and is not claimed.

## Initial implementation

- Local Ollama discovery and streamed conversation.
- Context profiles aimed at 16 GB shared-memory machines.
- Cancellation and observable timing.
- Responsive animated UI with reduced motion.
- Explicitly approved notes and restricted arithmetic.
- Local WAV transcription adapter and local browser speech output.
- Loopback and browser-request protections.
- Automated application tests, CI configuration, and operating documentation.

The existence of an adapter is distinct from complete end-to-end verification. Consult [verification](verification.md) for tested paths and limitations.

## Next: evidence and robustness

- Reproducible M5 model / context / memory measurements.
- Broader browser accessibility and voice testing.
- More adversarial protocol and cancellation fixtures.
- Recovery and migration rules for larger note collections.
- Model capability detection and clearer tool-support guidance.

## Then: local intelligence

- A provider interface for MLX and llama.cpp with comparable benchmarks.
- Explicit local document selection and cited retrieval.
- Inspectable memory inclusion and per-source deletion.
- Optional local neural TTS after measuring shared-memory costs.
- Voice activity detection and interruption behavior designed around consent.

These are planned directions, not capabilities exposed by the current release.

## Later: controlled automation

- A native macOS wrapper with signed releases and clearer process lifecycle.
- Scoped MCP integrations with a reviewed tool registry.
- Per-tool capability grants, approval receipts, and bounded workspaces.
- Opt-in scheduled tasks with clear pause and cancellation controls.

Shell execution, broad filesystem access, cloud fallback, remote connectors, and unattended background work should not appear as incidental additions. Each needs a separate threat model, explicit product controls, and meaningful tests.
