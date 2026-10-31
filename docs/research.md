# Research: a focused personal assistant for a 16GB M5 Mac

Research date: **31 October 2026**. Sources below were inspected on that date. Model tags and upstream default branches are mutable. This document records a design decision, not a benchmark report; no M5 inference measurements are claimed.

## Decision

Use a small quantized model through a loopback Ollama service as the first supported inference path. Evaluate `qwen3.5:4b` first, with a single active generation, a modest context budget, and explicit cancellation. Compare `gemma4:e2b` and `qwen3:4b` on the same tasks before changing the default. Keep audio and tools behind separate capability boundaries.

This recommendation optimizes for a usable 16GB laptop, an understandable installation, and observable behavior. It does not establish that a particular model is the fastest or best. An attractive animation cannot compensate for a slow model, and a model's advertised maximum context is not a sensible laptop memory setting.

## What OpenJarvis actually provides

[OpenJarvis](https://github.com/open-jarvis/OpenJarvis) is a substantial local-first framework, rather than a minimal chatbot. Its [README](https://github.com/open-jarvis/OpenJarvis/blob/main/README.md) describes both browser and packaged desktop interfaces, research and code assistants, scheduled agents, and voice briefings. Its [Apache-2.0 license](https://github.com/open-jarvis/OpenJarvis/blob/main/LICENSE) is independent of model licenses.

The [architecture documentation](https://open-jarvis.github.io/OpenJarvis/architecture/overview/) separates model intelligence, inference engines, agent logic, memory, and learning. Engines share generation, streaming, discovery, and health interfaces. Documented options include Ollama and llama.cpp; the [project dependency configuration](https://github.com/open-jarvis/OpenJarvis/blob/main/pyproject.toml) also includes MLX. The project supports several agent forms and a container wrapper for restricted execution.

Its [security architecture](https://open-jarvis.github.io/OpenJarvis/architecture/security/) documents composable scanners, redaction/blocking modes, file policies, and SQLite auditing. Security scanning is described as opt-in, so the presence of the module alone does not prove that every installation enforces a policy.

Its [telemetry documentation](https://open-jarvis.github.io/OpenJarvis/telemetry/) distinguishes local performance records from optional external analytics and voluntary leaderboard sharing. It says external analytics defaults off when no setting exists and documents explicit consent paths. It would be inaccurate to describe all OpenJarvis telemetry as cloud collection or to claim the framework lacks privacy controls.

These are documented capabilities, not independently reproduced results. The research did not run the complete OpenJarvis suite, audit every execution path, or verify its published efficiency claims.

## The original product opportunity

Auralis deliberately targets a narrower daily interaction than a general research framework. Its improvements should be judged on concrete user outcomes:

- A calm, animated workspace that reveals connection state, generation state, tool approvals, and privacy settings without making the user inspect logs.
- Fast feedback before inference completes: streamed output, a working stop control, and a clear missing-runtime explanation.
- A small, predictable local footprint instead of automatically starting several large models.
- Explicit separation between a conversation, microphone access, tool proposals, and approved tool execution.
- Honest local metrics and an installation path suitable for one 16GB Mac.

These are design goals and review criteria. They are not evidence of overall superiority to OpenJarvis. OpenJarvis remains more mature in several areas, including broad research infrastructure, agent variants, and integrations. Auralis is original application code; upstream projects inform requirements and are credited rather than silently copied.

## Current inference choices

### Ollama: the initial integration

[Ollama's macOS requirements](https://docs.ollama.com/macos) cover Apple M-series CPU/GPU support on macOS Sonoma or newer. Its [chat API](https://docs.ollama.com/api/chat) supports streamed generation, tool definitions, generation options, and timing/token fields. These provide a practical interface for a local application without embedding a model runtime in the UI process.

The choice is operational: model management, a stable local HTTP boundary, and an uncomplicated first-run check. Ollama also offers cloud models, so installing Ollama alone does **not** prove a session stays local. A local assistant must keep a loopback endpoint and reject cloud model routes rather than infer privacy from a brand name.

### MLX LM: an Apple-focused alternative

[MLX LM](https://github.com/ml-explore/mlx-lm) provides Apple Silicon generation, quantization, and streaming. It exposes prompt caching and configurable prefill/cache behavior. Its [server implementation](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/server.py) is a possible adapter boundary. MLX LM is MIT licensed; downloaded weights retain their own terms.

Evaluate MLX when it offers an actual improvement for the selected checkpoint on the target machine. Auralis does not assume that every MLX conversion supports every modality or tool template. A new adapter needs cancellation, errors, bounded output, and protocol tests before being advertised as supported. Do not enable model-provided remote Python code as a routine installation step.

### llama.cpp: explicit deployment control

[llama.cpp](https://github.com/ggml-org/llama.cpp) treats Apple Silicon as a supported target through Metal, Accelerate, and ARM optimizations and supports several quantization levels. Its [HTTP server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) offers compatible chat routes, constrained output, and tool support. The runtime is MIT licensed.

It is useful when a reproducible GGUF artifact, explicit context allocation, or a thin native process matters. Its current documentation includes the `llama serve` command; older installations may expose `llama-server`. Check the installed build's help rather than mixing flags across releases. A server's API compatibility does not guarantee identical sampling, tool parsing, or cancellation semantics.

## Models worth evaluating

The [Ollama Qwen3.5 registry](https://ollama.com/library/qwen3.5) lists small 0.8B, 2B, 4B, and 9B variants. The [4B tag](https://ollama.com/library/qwen3.5:4b) shows approximately 3.3GB for its llama.cpp artifact and 4.0GB for its MLX variant at inspection time. The [official Qwen3.5-4B card](https://huggingface.co/Qwen/Qwen3.5-4B) and [license](https://huggingface.co/Qwen/Qwen3.5-4B/blob/main/LICENSE) identify Apache-2.0. Prefer a verified quantized artifact to loading full-precision weights by accident.

[Gemma 4](https://ollama.com/library/gemma4) is a current alternative: E2B registry artifacts are about 4.6–7.5GB, with variation between runtime formats. Google's [official E2B card](https://huggingface.co/google/gemma-4-E2B-it) identifies Apache-2.0 and explains that effective parameters differ from total stored parameters. The small name alone is therefore a poor memory estimate.

The older [Qwen3 registry](https://ollama.com/library/qwen3) lists a 2.5GB 4B artifact and 5.2GB 8B artifact. It is a useful compatibility comparison, not a claim to be the newest release. Large mixture-of-experts models still require storage for their total weights: a small active-parameter count is not permission to fit a 20GB artifact inside 16GB of shared memory.

This shortlist is intentionally limited. Published leaderboard scores cannot determine the best model for the user's language, writing style, local documents, or tool schema. Vision and audio support in an upstream card do not mean this version of Auralis exposes those inputs.

## A realistic memory plan

The target is the user's stated **16GB M5 MacBook Pro**. Apple's [M5 MacBook Pro announcement](https://www.apple.com/newsroom/2025/10/apple-unveils-new-14-inch-macbook-pro-powered-by-the-m5-chip/) confirms that family and describes on-device AI improvements, but its marketing comparisons do not establish this application's latency.

The following are engineering budgets, not observed process measurements:

- Leave roughly 5–7GB for macOS, a browser, development tools, and variation in daily workload.
- Start with approximately 3–5GB of quantized language-model weights.
- Reserve additional headroom for runtime allocations, context/cache, prompt processing, and a small speech model. Their size depends on architecture, quantization, prompt length, and runtime.
- Keep one language generation active. Load a second language model only after measuring whether eviction, swapping, and reloads make the experience worse.

Begin at a 4K token context and bounded response length. Increase only after a repeatable workload remains responsive with green memory pressure. A 128K or 256K model specification is an architectural limit, not a promise that such a context fits comfortably on this laptop. Avoid changing macOS wired-memory limits as a first remedy for an oversized model.

## Voice without a cloud dependency

[whisper.cpp](https://github.com/ggml-org/whisper.cpp) is an MIT-licensed local transcription runtime with Apple acceleration options. Its documented approximate memory use is 388MB for `base`, 852MB for `small`, and 3.9GB for `large`; these figures are upstream guidance, not M5 measurements. The [server example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server) accepts local audio at `/inference` and defaults to loopback.

Use push-to-talk, short bounded recordings, a visible recording state, and immediate track cleanup. A browser speech-recognition API is not a reliable privacy substitute: implementations may send audio to a service. Auralis should send recorded audio only to its configured local transcription boundary. Spoken output should use an explicitly selected installed local voice or a separately audited local TTS adapter.

Voice release acceptance must include permission denial, silence, a missing model, server unavailability, stop/cancel, and memory pressure while an LLM is loaded. Test the user's real accent and languages; `base.en` is an English-only convenience and should not be presented as a multilingual default.

## Evidence required before saying “faster”

Run identical tasks through both products and selected models with versions, model digests, quantization, context length, power mode, and temperatures recorded. Separate a cold load from warm inference. Record first visible output, completion latency, output tokens/second, memory pressure, and task success. For voice, include end-of-speech to first audible response, not only transcription runtime.

Use at least a small repeated set of writing, factual uncertainty, coding, long-context, malformed tool-call, and prompt-injection cases. Report median and tail latency with failures retained. Never turn mock-server tests or animation frame rate into an inference benchmark. Until this exists, “designed for responsive local use” is supportable; “fastest assistant” is not.

## Research limits and maintenance

No weights were downloaded for this research, and no local M5 token-rate, accuracy, energy, or thermal measurements were made. Sources were live default-branch documentation and registries, not a complete reproducible upstream snapshot. Before a release, record exact runtime versions and model digests in a local benchmark report, review changed licenses, and retest API behavior. Keep cloud integrations as a separate explicit product decision.
