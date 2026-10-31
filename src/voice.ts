/** Encode bounded microphone samples as mono PCM WAV. No audio leaves loopback. */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const inputLength = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const input = new Float32Array(inputLength);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const outputRate = 16000;
  const length = Math.floor(input.length * outputRate / sampleRate);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const write = (at: number, text: string) => [...text].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, outputRate, true);
  view.setUint32(28, outputRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, length * 2, true);
  for (let index = 0; index < length; index++) {
    const position = index * sampleRate / outputRate;
    const left = Math.floor(position), fraction = position - left;
    const sample = Math.max(-1, Math.min(1, input[left] * (1 - fraction) + (input[left + 1] ?? input[left]) * fraction));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface Capture {
  finish: () => Promise<Blob>;
  dispose: () => void;
}

export async function startCapture(): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  let context: AudioContext;
  try { context = new AudioContext(); } catch (error) { stream.getTracks().forEach(track => track.stop()); throw error; }
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor provides a small, dependency-free capture path. A future native
  // shell can replace it with AudioWorklet without changing the WAV adapter contract.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain(); mute.gain.value = 0;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; processor.onaudioprocess = null;
    source.disconnect(); processor.disconnect(); mute.disconnect();
    stream.getTracks().forEach(track => track.stop()); void context.close();
  };
  const chunks: Float32Array[] = []; let sampleCount = 0;
  const sampleLimit = Math.floor(context.sampleRate * 30);
  processor.onaudioprocess = event => {
    const input = event.inputBuffer.getChannelData(0);
    const remaining = sampleLimit - sampleCount;
    if (remaining <= 0) { dispose(); return; }
    const bounded = new Float32Array(input.subarray(0, remaining));
    chunks.push(bounded); sampleCount += bounded.length;
    if (sampleCount >= sampleLimit) dispose();
  };
  source.connect(processor); processor.connect(mute); mute.connect(context.destination);
  try { await context.resume(); } catch (error) { stream.getTracks().forEach(track => track.stop()); await context.close(); throw error; }
  return { dispose, finish: async () => { dispose(); return encodeWav(chunks, context.sampleRate); } };
}
