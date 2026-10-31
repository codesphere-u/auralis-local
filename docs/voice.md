# Local voice

Auralis uses explicit recording and an optional local speech-to-text service. It does not use browser speech recognition. Typed chat remains available when transcription is not configured.

## Start a whisper.cpp server

The following follows the upstream [whisper.cpp quick start](https://github.com/ggml-org/whisper.cpp#quick-start) and [HTTP server example](https://github.com/ggml-org/whisper.cpp/tree/master/examples/server), checked on 2026-10-31. Install Xcode command-line tools and CMake first if they are missing.

Run these in a directory where you want to keep the separate runtime checkout:

```sh
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
sh ./models/download-ggml-model.sh base.en
cmake -B build
cmake --build build -j --config Release
./build/bin/whisper-server \
  -m models/ggml-base.en.bin \
  --host 127.0.0.1 \
  --port 8080
```

The checkout and model download need network access. Review upstream changes and license terms before installing. Use `base` instead of `base.en` when you need the multilingual model; update the filename in the launch command accordingly. Start with a small model on a 16 GB Mac so the chat and voice models can coexist.

Do not launch the service as an administrator. Keep it bound to loopback. Auralis sends WAV directly, so the optional server-side audio conversion mode is unnecessary.

## Connect Auralis

In the terminal where you start Auralis:

```sh
export WHISPER_URL=http://127.0.0.1:8080/inference
npm run dev
```

For built mode, use `npm start` after a successful build. Restart the API after changing environment variables. Copying a value into `.env` alone does not load it.

Configuration enables the recorder control; a successful configuration check does not demonstrate transcription quality or service readiness. The first real recording verifies the complete path.

## Record and review

1. Press the microphone control and allow microphone access if prompted.
2. Speak while the recording state is visible.
3. Stop recording. The browser sends a WAV payload to the local transcription path.
4. Review the transcript before sending it as a chat message.

The browser caps capture at 30 seconds and encodes mono 16 kHz PCM WAV. It inserts the transcript into the draft for review without sending it automatically. Hiding the page, navigating away, or unmounting the recorder releases resources and discards an active capture. Microphone tracks are released after capture.

The server limits uploads to 10 MiB and checks the WAV signature; it does not independently validate audio duration. Auralis does not intentionally retain audio recordings. whisper.cpp and operating system logs remain independently configured software.

The upstream HTTP server accepts a multipart file at `/inference`. Auralis handles that multipart conversion; browser clients use the Auralis `audio/wav` endpoint rather than contacting whisper.cpp directly.

## Spoken output

Speech output uses the browser speech synthesis interface and selects only voices whose `localService` flag is true. No remote voice is selected as a fallback. If none is available, responses remain readable as text.

Voice availability and quality depend on the browser and installed macOS voices. Install an operating system voice through macOS settings if needed, then reload the page. Browser voice lists may appear asynchronously. The local flag is a browser-provided assertion, not an independent audit of the speech engine.

## Limits and future work

This release uses user-started recording rather than an always-listening wake word. It does not promise full-duplex interruption, speaker identification, continuous transcription, or neural voice cloning. Native voice activity detection and a local neural TTS provider are future integration options, subject to memory and permission design.

No complete microphone-to-transcript or spoken-output result should be reported as verified until exercised on the target browser with actual audio. See [verification](verification.md).
