import { homedir } from 'node:os';
import { resolve } from 'node:path';

export function loopbackEndpoint(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash) {
    throw new Error('Inference endpoints must use plain HTTP on numeric loopback 127.0.0.1, without credentials, query or fragment.');
  }
  return url.href.replace(/\/$/, '');
}
export function configFromEnv(env = process.env) {
  const port = Number(env.AURALIS_PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid AURALIS_PORT');
  const ollama = loopbackEndpoint(env.OLLAMA_URL || 'http://127.0.0.1:11434');
  if (new URL(ollama).pathname !== '/') throw new Error('OLLAMA_URL must be a server origin without a path');
  return {
    port, dev: env.AURALIS_DEV === '1', model: env.AURALIS_MODEL || 'qwen3.5:4b',
    ollama, whisper: env.WHISPER_URL ? loopbackEndpoint(env.WHISPER_URL) : undefined,
    dataDir: resolve(env.AURALIS_DATA_DIR || resolve(homedir(), '.auralis')),
  };
}
export type Config = ReturnType<typeof configFromEnv>;
