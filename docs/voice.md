# Voice conversations on your Mac

Choose **Let’s talk** in the conversation screen for a dedicated voice room: local voice selection, speech speed, captions, pause detection, interruption, and optional continued listening. Microphone access starts only after you press the central microphone button. Voice mode sends a turn automatically after about 950 ms of silence following speech; the captions explain this before recording begins. Ordinary dictation in the text composer still inserts a draft for review.

## Recommended Apple Silicon setup

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) if needed. From the Auralis folder:

```sh
npm run voice:setup
npm run build
npm run talk
```

Keep Ollama running. Open `http://127.0.0.1:4317`, choose **Let’s talk**, then press the microphone and grant the browser permission. This Mac already completed `voice:setup` during development. Other checkouts need their own setup.

The setup installs pinned Python 3.12 dependencies and downloads the multilingual [Whisper base MLX conversion](https://huggingface.co/mlx-community/whisper-base-mlx/tree/1e3e249) (about 144 MB weights). Package dependencies need additional disk space. [MLX Whisper](https://github.com/ml-explore/mlx-examples/tree/main/whisper) runs on Apple Silicon. The helper passes PCM arrays directly to the model, so no ffmpeg installation is required for this recording path. Dependencies retain their own licenses; original Whisper is MIT licensed.

Weights and cache live in ignored `.auralis/voice/` inside the project. Setup needs the internet; `voice:start` uses uv offline mode and a local weight path with Hugging Face offline mode. It never fetches weights during transcription. No model-provided Python code is enabled. The helper only accepts server-to-server requests on numeric loopback, rejects browser Origin/Fetch headers, limits payloads to 1 MiB and validates mono 16-bit 16 kHz WAV duration (0.1–30 seconds). Audio and transcripts remain in process memory and are not intentionally logged or saved. The existing Auralis proxy retains its session, CSRF and origin checks.

To start the pieces separately, use `npm run voice:start` and `npm run start:voice`. `npm run talk` starts both and stops both when interrupted. Port 8080 is reserved for the local speech helper; do not start two speech servers on that port.

## Fast turn-taking and interruption

Voice mode prefers an installed `qwen3.5:2b`, otherwise an installed model you can select. It uses a 2,048-token context, a 192-token response budget, no tool execution, and a short conversational system instruction. It includes up to ten recent messages, clipped to 4,000 characters each. Tools remain available in the regular text conversation with their existing approval rules.

Speech begins as complete sentences arrive, rather than waiting for the full reply. Long punctuation-free text is split at word boundaries. Only installed browser voices marked `localService` are available. Choose Natural, Gentle or Quick playback speed. **Read aloud** also works on completed text replies; the speaker button enables sentence-by-sentence speech for new typed chats.

Tap the main button during a reply to interrupt generation and speech and open the microphone for your next turn. Tap the muted microphone to pause, or the red phone to leave. With **Continue listening after each reply** checked, the microphone reopens after speech finishes. Uncheck it for manual turns. Silence without detected speech returns to idle after seven seconds; each recording is capped at thirty seconds. RMS-based pause detection is a simple heuristic and can struggle with quiet voices or noisy rooms. Use the finish button when the automatic timing does not suit you.

The microphone is off during playback to avoid hearing the assistant's own voice. This is half-duplex turn-taking, with a tap to interrupt; it is not simultaneous listening and speaking. Closing, hiding or navigating away from the voice screen stops recording, requests and speech. If playback errors or exceeds its deadline, voice mode pauses instead of leaving the microphone armed. A short in-flight native transcription may finish after its HTTP client disconnects.

## Alternative: whisper.cpp

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

## Verification and limits

Synthetic Mac speech was transcribed through the installed helper and through the Auralis API on 2026-10-31. The complete local text-to-audio-to-transcript-to-short-model-reply path was exercised. A proper name was misrecognized, so this is not an accuracy benchmark. Automated tests cover PCM encoding, pause detection, speech buffering, cancellation and voice response budgets.

Live microphone hardware, noisy-room accuracy, perceived naturalness and acoustic speaker output still need a user session. The browser local-voice flag is not an independent audit of the operating system speech engine. There is no wake word, speaker identification, voice cloning or remote voice fallback.
