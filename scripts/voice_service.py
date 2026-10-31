# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = ["mlx-whisper==0.4.3", "huggingface-hub==0.36.0"]
# ///
"""Optional Apple Silicon dictation. Audio stays in memory; no recording files."""
import argparse
import io
import json
import os
from pathlib import Path
import threading
import wave
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent / ".auralis" / "voice"
os.environ["HF_HOME"] = str(ROOT / "cache")
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
MODEL_REPO = "mlx-community/whisper-base-mlx"
MODEL_PATH = ROOT / "model"
MAX_BYTES = 1_048_576


def load_audio(data):
    import numpy as np
    with wave.open(io.BytesIO(data), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 16000, "NONE"):
            raise ValueError("Expected mono 16kHz 16-bit PCM WAV")
        count = wav.getnframes()
        if not 1600 <= count <= 480000:
            raise ValueError("Audio must be between 0.1 and 30 seconds")
        frames = wav.readframes(count)
        if len(frames) != count * 2:
            raise ValueError("Incomplete WAV")
    return np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--setup", action="store_true")
    args = parser.parse_args()
    if args.setup:
        from huggingface_hub import snapshot_download
        ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        print("Downloading multilingual Whisper base weights for local dictation…", flush=True)
        snapshot_download(MODEL_REPO, revision="1e3e249", token=False, local_dir=str(MODEL_PATH), allow_patterns=["config.json", "weights.npz", "*.safetensors"])
        print("Local voice is installed. Next: npm run voice:start", flush=True)
        return
    os.environ["HF_HUB_OFFLINE"] = "1"
    if not (MODEL_PATH / "config.json").is_file():
        raise SystemExit("Run npm run voice:setup first. Serving never downloads weights.")
    import mlx_whisper
    import numpy as np
    # Load weights before announcing readiness, avoiding a first-turn download/load.
    mlx_whisper.transcribe(np.zeros(16000, dtype=np.float32), path_or_hf_repo=str(MODEL_PATH), verbose=False)
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Do not log audio, transcripts or request contents.

        def reply(self, status, payload):
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def trusted(self):
            return self.headers.get("Host") == "127.0.0.1:8080" and not self.headers.get("Origin") and not self.headers.get("Sec-Fetch-Site")

        def do_GET(self):
            if not self.trusted():
                return self.reply(403, {"error": "Server-to-server access only"})
            self.reply(200 if self.path == "/health" else 404, {"ready": self.path == "/health"})

        def do_POST(self):
            self.connection.settimeout(15)
            if not self.trusted():
                return self.reply(403, {"error": "Server-to-server access only"})
            if self.path != "/inference":
                return self.reply(404, {"error": "Not found"})
            if not lock.acquire(blocking=False):
                return self.reply(429, {"error": "Transcription busy"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                content_type = self.headers.get("Content-Type", "")
                if not 44 <= length <= MAX_BYTES or not content_type.startswith("multipart/form-data;"):
                    return self.reply(400, {"error": "Invalid bounded WAV upload"})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    return self.reply(400, {"error": "Incomplete upload"})
                message = BytesParser(policy=default).parsebytes(("Content-Type: " + content_type + "\r\nMIME-Version: 1.0\r\n\r\n").encode() + raw)
                files = [p for p in message.iter_parts() if p.get_param("name", header="content-disposition") == "file"]
                if len(files) != 1:
                    raise ValueError("One WAV required")
                samples = load_audio(files[0].get_payload(decode=True))
                if float(np.sqrt(np.mean(samples * samples))) < 0.003:
                    return self.reply(200, {"text": ""})
                result = mlx_whisper.transcribe(samples, path_or_hf_repo=str(MODEL_PATH), condition_on_previous_text=False, temperature=0.0, verbose=False)
                segments = result.get("segments", [])
                text = "" if segments and all(s.get("no_speech_prob", 0) > 0.6 for s in segments) else result["text"].strip()
                self.reply(200, {"text": text[:16000]})
            except (ValueError, wave.Error):
                self.reply(400, {"error": "Invalid audio"})
            except Exception:
                self.reply(500, {"error": "Local transcription failed"})
            finally:
                lock.release()

    server = ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
    server.daemon_threads = True
    print("Local voice ready at http://127.0.0.1:8080/inference", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
