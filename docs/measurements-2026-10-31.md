# Preliminary M5 measurements — 2026-10-31

These are six short local inference trials on the target Mac. They establish that the measured models generated output through Auralis's provider path. They are not a statistical comparison, sustained-load benchmark, quality evaluation, or comparison with OpenJarvis.

## Environment and settings

- Apple M5 MacBook Pro, 16 GB unified memory.
- macOS 27.2; Node.js 24.22.0.
- Ollama client and server 0.40.13; server version verified through `/api/version`.
- `qwen3.5:4b`: installed digest `7f3251fa6878a78a606bcb3c074283306e5ad2ea411a7774a9dd98a4bc7f2d13`; observed model metadata reports safetensors, NVFP4, and the MLX runner.
- `qwen3.5:0.8b`: installed digest `d9c89605f39abfd9e8cb4fd3c099c203d7d17e82d7765b4266a0612402d88f1c`.
- Context 2,048 tokens; thinking disabled; temperature 0.6; output budget 1,024 tokens; tools disabled.
- Three consecutive trials per model using [the benchmark script](../scripts/benchmark.ts).

Fixed prompt:

> Explain why the sky appears blue in exactly two concise sentences.

First-trial model loading and residency were not controlled, so these trials must not be labeled “cold.” Later trials were consecutive short requests; their conditions were not independently characterized. No memory pressure, power consumption, power mode, thermal state, or background workload measurements were recorded. Model digests identify the installed inventory entries; the observations still lack a complete reproducibility record.

## Recorded results

Time to first text and total time are measured by the benchmark client around the provider call. They include model metadata verification and HTTP overhead. Tokens per second use Ollama's reported output token count and evaluation duration; that rate excludes some request overhead and should not be substituted for end-to-end latency.

`qwen3.5:0.8b`:

- Trial 1: first text **1,170 ms**; total **1,955 ms**; **74** output tokens; **93.2 tokens/s**.
- Trial 2: first text **166 ms**; total **821 ms**; **58** output tokens; **86.9 tokens/s**.
- Trial 3: first text **36 ms**; total **591 ms**; **52** output tokens; **91.7 tokens/s**.

`qwen3.5:4b`:

- Trial 1: first text **2,726 ms**; total **5,007 ms**; **71** output tokens; **30.7 tokens/s**.
- Trial 2: first text **113 ms**; total **2,089 ms**; **61** output tokens; **30.3 tokens/s**.
- Trial 3: first text **74 ms**; total **2,087 ms**; **62** output tokens; **30.3 tokens/s**.

The outputs have different lengths and were sampled with nonzero temperature. The prompt requests two sentences, but these timing records alone do not establish instruction-following accuracy. Auralis does not use these values as fixed promises in its interface.

## Reproduce and extend

With the two models already installed and Ollama running locally:

```sh
npm run benchmark -- qwen3.5:0.8b qwen3.5:4b
```

The script never downloads weights. Preserve exact runtime versions, full model digests, raw results, a fixed application revision, and model residency state in a stronger follow-up. Use repeated task sets, correctness checks, and memory / thermal observations before making model recommendations based on speed. See [the measurement methodology](benchmarking.md).
