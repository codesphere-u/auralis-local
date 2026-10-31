# Measuring performance

Auralis is designed to feel responsive without making the interface compete heavily with inference. No speed claim follows from architecture alone. Keep upstream benchmark claims separate from measurements made with this application.

## Record the environment

For every run, record:

- Exact Auralis commit SHA and clean / modified working tree state.
- Mac model, chip, unified memory, macOS version, power mode, power connection, and thermal state.
- Node, Ollama, and optional transcription runtime versions.
- Exact model identifier, quantization, model digest where available, and installed size.
- Context length, output budget, sampling settings, prompt, tool setting, and prior conversation length.
- Cold or warm model state and other applications using significant memory.

Do not publish personal hardware serial numbers or private prompts with benchmark records.

## Chat latency

Use a fixed synthetic prompt set covering a brief answer, a longer explanation, arithmetic, and a proposed note. Keep settings constant across comparisons.

Measure cold start separately. Then warm the model once and collect at least ten comparable runs for a useful small sample. Report median and tail latency with the sample count. Preserve failures rather than dropping them silently.

- **Time to first text:** elapsed time from the request to the first displayed text fragment. It includes application and runtime work. With reasoning models it may differ from the first internal token.
- **Total time:** request start to stream completion, including tool steps if present.
- **Generation throughput:** use provider output token count divided by provider evaluation duration when available. Do not count NDJSON text fragments as tokenizer tokens.
- **Prompt throughput:** report separately from output generation, if available.

The interface can show observed timing for a request. A single live number is diagnostic feedback, not a comparative benchmark. A response that errors, is cancelled, or produces no content must be labeled accordingly.

## Memory

Watch Activity Monitor's memory pressure and swap, not only the model file size. Unified memory also serves macOS, the browser, graphics, model runtime, KV cache, and optional speech models.

Run the same model at Fast and Balanced context sizes. Record peak memory / pressure during a long response and after idle unloading. Repeat with voice enabled before selecting a default speech model. Use practical degradation signals: sustained swap, missed interaction frames, long stalls, or operating system termination.

## Interface smoothness

Check the first screen, sustained token streaming, long conversations, memory lists, and active voice capture. Use browser performance tooling to inspect frame time, main-thread stalls, and layout work. Check a narrow window and reduced motion.

Record production build asset sizes separately from development server traffic. A small JavaScript bundle does not establish that all animation is smooth; verify the actual rendering path.

## Voice

Use fixed, consented or synthetic recordings. Record audio duration, language, microphone / file source, speech model, and warm state. Measure transcription wall time and real-time factor (processing time divided by audio duration). Assess transcription errors on the same reference transcript.

For spoken output, measure perceived start latency and cancellation behavior separately. Report the exact operating system voice and browser. Do not compare a local voice against a remote service without explaining the different data paths.

## Comparing assistants

Use identical hardware, model weights, quantization, context, prompts, power conditions, and a documented procedure. Compare correctness, resource use, latency, and feature scope. An application with fewer capabilities should not be described as generally superior solely because it has less work to do.

The [verification record](verification.md) should link actual captured results. If a model or voice measurement has not run, write “not measured” rather than estimating a score.
