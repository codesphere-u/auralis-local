# Auralis

[![CI](https://github.com/codesphere-u/auralis-local/actions/workflows/ci.yml/badge.svg)](https://github.com/codesphere-u/auralis-local/actions/workflows/ci.yml)

**A calm, expressive assistant that keeps inference on your Mac.**

Auralis combines a fast animated interface, streamed local chat, deliberate memory, and small tools with explicit approval for writes. It is an original implementation inspired by the local AI movement, including [OpenJarvis](https://github.com/open-jarvis/OpenJarvis). It does not embed or fork OpenJarvis.

Built for a 16 GB Apple Silicon Mac. The starting model is `qwen3.5:4b` through Ollama. Smaller context profiles, a single active generation, short model residency, and CSS animation keep the design practical for shared memory hardware. Actual speed depends on the selected model, runtime, prompt, and machine state; Auralis does not claim to outperform OpenJarvis or other assistants without a controlled comparison.

## What is implemented

- Streamed chat with cancellation, model selection, and Fast / Balanced context profiles.
- An animated interface with keyboard access, responsive layouts, and reduced motion support.
- Local model discovery and honest disconnected states.
- A restricted calculator and model-proposed note saving with individual approval.
- A memory view to inspect and delete saved notes; conversations stay in the page session by default.
- Push-to-record voice input through an optional local whisper.cpp server. Speech output selects only browser voices marked as local.
- Loopback-only services, request validation, origin checks, session / CSRF protection, bounded requests, and redacted audit events.
- Automated checks and a GitHub Actions workflow. See the [verification record](docs/verification.md) for what was actually run.

## Start on your Mac

Install [Node.js](https://nodejs.org/) 22.12 or newer and [Ollama](https://ollama.com/download/mac). Model downloads need internet access; normal chat uses the local service.

Get the source first:

```sh
git clone https://github.com/codesphere-u/auralis-local.git
cd auralis-local
```

```sh
ollama serve
```

If the Ollama desktop app is already running, a second server is unnecessary. In another terminal:

```sh
ollama pull qwen3.5:4b
npm install
npm run dev
```

Open the local address printed by Vite, normally `http://127.0.0.1:5173`. Select an installed model and send a message. Keep Ollama running while you chat.

For a single built application server:

```sh
npm run build
npm start
```

Open `http://127.0.0.1:4317`. The built interface and API share that address.

If no model is installed, the interface still opens and explains how to connect. It does not invent an assistant response. Start with [the Mac setup guide](docs/setup.md) if a connection fails.

## Privacy in practice

Chat messages live in browser memory until the page is refreshed or cleared. There is no automatic cloud fallback and no analytics integration. Approving a note writes that note to the application data directory. The audit log records event metadata rather than chat text. Model and transcription services are separately installed software and retain their own settings and logs.

Do not expose Auralis or its inference services to a network. Localhost protections reduce browser-origin attacks; they do not isolate the application from malware or another process running as your user. Read the [security model](docs/security.md) before extending tool capabilities.

## Documentation

- [Mac setup and troubleshooting](docs/setup.md)
- [Model and runtime choices](docs/model-guide.md)
- [OpenJarvis and local inference research](docs/research.md)
- [Architecture and extension boundaries](docs/architecture.md)
- [API reference](docs/api.md)
- [Local voice setup](docs/voice.md)
- [Privacy and threat model](docs/security.md)
- [Measurement methodology](docs/benchmarking.md)
- [Preliminary M5 observations](docs/measurements-2026-10-31.md)
- [Verification evidence](docs/verification.md)
- [Roadmap and scope](docs/roadmap.md)
- [Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md)

## Development

```sh
npm test
npm run build
```

The build includes TypeScript checking. The automated suite uses controlled local fixtures rather than downloading model weights. A passing suite verifies application behavior; it is not an inference quality or M5 speed benchmark.

## License

Auralis source is [MIT licensed](LICENSE). Models, inference runtimes, operating system voices, and dependencies have separate licenses. No model weights are bundled. See the model guide before distributing a model-backed product.
