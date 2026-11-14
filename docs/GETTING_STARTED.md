# Getting Started with Auralis (`v0.4.0`)

Auralis is a private, local-first AI workspace built for 16 GB Apple Silicon Macs using Ollama (`qwen3.5:4b`), zero-dependency PDF extraction, hybrid BM25 retrieval, and an optional voice room.

## 1. Install & Run

```sh
git clone https://github.com/codesphere-u/auralis-local.git
cd auralis-local
ollama pull qwen3.5:4b
npm install
npm run check
npm run dev
```

## 2. Production Build & Voice Room

```sh
npm run build
npm start
# Or with local MLX dictation:
npm run voice:setup && npm run talk
```
