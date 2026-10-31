# Run Auralis on an Apple Silicon Mac

## Requirements

- Apple Silicon Mac with 16 GB unified memory as the initial target.
- Node.js 22.12 or newer and npm.
- Ollama for local chat.
- Enough disk space for dependencies and your selected model.
- Optional: CMake, Xcode command-line tools, and whisper.cpp for local transcription.

The development machine was identified as an M5 MacBook Pro with 16 GB memory. That identifies the host; it does not establish a model performance result. Check the [verification record](verification.md) for completed validation.

## 1. Install and start Ollama

Download the macOS application from [Ollama](https://ollama.com/download/mac), or use its documented installation route. Open it, then run:

```sh
ollama list
ollama pull qwen3.5:4b
```

If you use the command-line server without the desktop app, keep `ollama serve` running in a separate terminal. A model pull downloads several gigabytes and needs network access. Auralis never starts downloads automatically.

For predictable 16 GB operation, run one model at a time and close other memory-heavy applications. Keep inference services bound to `127.0.0.1`. Do not set an all-interface bind address to solve a connection problem.

## 2. Start development

From the Auralis repository:

```sh
npm install
npm run dev
```

The development command starts the API on port 4317 and Vite on port 5173. Open the printed local Vite address. Vite forwards `/api` requests to the local API. Use that local address consistently; mixing `localhost` and `127.0.0.1` can affect cookies and origin checks.

The model selector lists models returned by Ollama. If the default `qwen3.5:4b` is absent, install it or choose an available model.

## 3. Run the built interface

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4317`. This uses one server for the built static interface and API. Keep Ollama running independently. `npm start` does not build missing assets or install model weights.

## 4. Optional voice

Follow [the local voice guide](voice.md). The microphone is requested only when you start recording. Transcription needs the explicitly configured local service; typing works without it.

## Configuration

The repository's `.env.example` documents configuration, but the app does not automatically load `.env` files. Export values in the terminal that starts the API:

```sh
export AURALIS_MODEL=qwen3.5:4b
export OLLAMA_URL=http://127.0.0.1:11434
# Optional:
export WHISPER_URL=http://127.0.0.1:8080/inference
npm run dev
```

Leave `WHISPER_URL` unset until a local transcription service is running. `AURALIS_DATA_DIR` changes the persistent data directory. The [API reference](api.md#configuration) lists all settings and validation rules. When using the default development proxy, keep the API at its default port 4317; changing that port also requires updating the Vite proxy target.

## Storage

By default application data lives in `~/.auralis`:

- `notes.json`: notes you explicitly approved saving.
- `audit.jsonl`: redacted event metadata.

The app does not automatically save chat transcripts. Refreshing loses the in-page conversation. Use the export control if you want a copy, and treat that export as private data. Erasing a conversation does not automatically delete saved notes or downloaded models; review memory separately.

To reset persistent Auralis data, stop the server first and remove the application data directory using Finder. This deletes notes and audit history. Existing backups and filesystem snapshots may retain copies. Downloaded Ollama models are managed separately by Ollama.

## Troubleshooting

### “Ollama disconnected”

Run `ollama list`. If it fails, open Ollama or start `ollama serve`. Verify the server is listening on its normal loopback port, 11434. Auralis will show a connection error instead of a generated response.

### The model is slow or memory pressure rises

Choose Fast, use a smaller quantized model, shorten the conversation, and close applications using large amounts of memory. Reducing context usually matters more than the size of the interface. Avoid running a large transcription model and a large chat model together. See [model guidance](model-guide.md).

### A request is rejected after switching addresses

Reload the page at the same local address you used to open the app. The browser must obtain a new session token after a server restart. Requests from arbitrary origins and hostnames are deliberately rejected.

### Port is already in use

Stop an earlier Auralis development process before starting another. Do not kill an unrelated process without identifying it. Server startup output reports binding errors.

### No microphone or no local voice

Microphone permission belongs to the browser. Use a loopback address and check the browser's microphone setting. Auralis does not use browser cloud speech recognition. If no local speech synthesis voice is available, output remains text; install an operating system voice or use another browser.

### The model does not use a tool

Tool following depends on the model and runtime. Enable tools, use a clear request, and check that your installed model supports tool calls. A note write still requires approval. The app never converts ordinary model text into executable code.
