# Local model and voice guide

Last researched: **31 October 2026**. See [research.md](research.md) for sources, comparisons, and evidence limits. This guide describes the shipped Ollama integration. MLX LM and llama.cpp are researched alternatives; there is no direct MLX or compatible-chat adapter in this release.

## Recommended first model

Start with `qwen3.5:4b`. It is a conservative candidate for a 16GB M5 Mac, not a measured winner. Prefer explicit tags to a moving `latest` alias. A smaller `qwen3.5:0.8b` or `qwen3.5:2b` can be useful for checking responsiveness or reducing memory use, with quality assessed separately.

Install the official [Ollama macOS application](https://ollama.com/download/mac), then inspect the local inventory before downloading anything:

```sh
ollama --version
ollama list
```

If the selected model is absent, download it explicitly. This requires internet access and disk space; later generation can run offline once the runtime and all weights are installed.

```sh
ollama pull qwen3.5:4b
ollama show qwen3.5:4b
```

Do not pull a model solely because its name says “4B active.” The complete artifact must fit alongside the operating system, its context/cache, and other active models. In particular, a `gemma4:26b` artifact is unsuitable as this project's default on a 16GB Mac.

Configure Auralis's server process using these environment variables:

```sh
AURALIS_MODEL=qwen3.5:4b
OLLAMA_URL=http://127.0.0.1:11434
```

Use the launch command in the [README](../README.md) to start the application. When overriding the model from the terminal, apply the variables to that command or export them in that terminal first. Never place secrets in frontend configuration. Model names are not secrets, and this integration does not require a cloud API key.

## Keep inference local

The application accepts HTTP endpoints on numeric `127.0.0.1`; it rejects arbitrary remote inference URLs. Keep the Ollama listener on loopback as well. Do not expose either service on `0.0.0.0`, configure a public tunnel, or select a cloud model if the goal is offline inference. The application does not turn a remote runtime into a private one.

For an Ollama process started manually, a conservative environment is:

```sh
OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NUM_PARALLEL=1 OLLAMA_MAX_LOADED_MODELS=1 ollama serve
```

Run this only if another Ollama instance is not already listening. A macOS menu-bar application may already own the port; quitting and restarting that application is different from starting a second server. Settings for a separately running Ollama process must be applied to that process, not merely to Auralis. For an existing application installation, follow [Ollama's local-only configuration](https://docs.ollama.com/faq#how-do-i-disable-ollamas-cloud-features) and restart Ollama. Its documented `OLLAMA_NO_CLOUD=1` setting disables cloud features in the runtime itself.

The [Ollama FAQ](https://docs.ollama.com/faq) documents context configuration, loaded-model inspection, and keep-alive controls. Review runtime changes when upgrading; defaults may evolve. For this laptop, start with one request at a time and a 4K context. A model's maximum advertised context should not become an automatic allocation target.

## Confirm the connection

Check the local service independently before diagnosing the UI:

```sh
curl --fail http://127.0.0.1:11434/api/tags
ollama ps
```

Then choose the installed model in Auralis and send a short prompt. Confirm that output streams, Stop interrupts generation, and the interface identifies failures without inventing an answer. An available model appearing in a list proves discovery; a completed prompt proves that generation path. Neither proves accuracy on every task.

To establish offline behavior, finish installation first, disconnect external networking, reload the app from its running local server, and send a new prompt. The current version has no cloud fallback. A response completed before disconnecting is not an offline test.

## Compare models fairly

Use a small task set you care about: a short email, a code explanation, a question that should admit uncertainty, a long note, and a proposed tool action. Keep prompts, context, generation length, and power mode consistent. Record the exact model digest from your installed inventory, runtime version, and whether the model was warm.

Try alternatives one at a time. `qwen3:4b` is a compatibility baseline; `gemma4:e2b` is a current comparison candidate with a different memory profile. Read each model's card and license before redistribution. As of the research date, Qwen3.5-4B and Google's Gemma 4 E2B cards identify Apache-2.0, while older Gemma releases can have different terms. A runtime's MIT license does not replace model terms.

Watch Activity Monitor's Memory Pressure while running a realistic session. If it turns yellow or red, reduce context, stop other loaded models, use a smaller checkpoint, or shorten prompts. Do not use swap capacity as a target memory budget. Large first-response delays may be model loading, prompt processing, or memory pressure; distinguish these before attributing the delay to the UI.

## Optional local transcription

Voice input uses a separate local transcription service. It is optional; text chat does not require it. The shipped server can forward audio to this configured endpoint:

```sh
WHISPER_URL=http://127.0.0.1:8080/inference
```

Follow the upstream [whisper.cpp build and model instructions](https://github.com/ggml-org/whisper.cpp) and [server guide](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server). For a source checkout whose built binaries are in `build/bin`, a representative command is:

```sh
./build/bin/whisper-server --host 127.0.0.1 --port 8080 -m models/ggml-base.bin
```

Use a model file you have actually downloaded. `base` is multilingual; `base.en` is English-only. Check `whisper-server --help` on your installed version for supported audio formats and flags. Some compressed formats need conversion support and an installed converter; do not assume every browser recording is accepted by every build.

Start with a small speech model so it can coexist with the language model. Record a short sample, stop recording, review the transcription, and explicitly send the resulting text. Test permission refusal and a missing service before relying on voice. Silence can still produce transcription errors; a transcript is untrusted input, not authorization to execute tools.

For spoken output, use only a voice reported by the system/browser as local. Voice availability depends on installed operating-system assets. If no suitable local voice exists, keep text output available rather than silently using a remote speech service. Browser speech recognition is not used as a substitute for local transcription.

## Troubleshooting

- **Connection refused:** verify Ollama is running at the configured loopback port. Auralis cannot load weights into a stopped runtime.
- **Model unavailable:** compare the exact selected tag with `ollama list`; an alias and a versioned tag may differ.
- **Slow first answer:** compare the second request, inspect memory pressure, and check whether another model is resident.
- **Empty or truncated answer:** reduce prompt size, check the response limit, and inspect whether a reasoning mode consumed the available generation budget.
- **Voice unavailable:** verify `WHISPER_URL`, inspect the transcription service, and check microphone permission. Text chat should remain usable.
- **No local spoken voice:** install a suitable operating-system voice or leave speech off. Do not enable a remote voice to conceal an unavailable local capability.

When reporting an issue, include the Auralis commit, macOS/runtime versions, model tag/digest, context setting, sanitized error, and reproducible steps. Do not attach private conversations, recordings, local file contents, or credentials by default.
