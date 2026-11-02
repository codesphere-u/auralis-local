import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ollama, parseNDJSON } from '../server/provider.ts';
import { configFromEnv } from '../server/config.ts';
import { KnowledgeBase } from '../server/knowledge.ts';
import { calculate } from '../server/calculator.ts';

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx] * 1000) / 1000;
}

export async function runLocalPipelineBenchmark() {
  const dir = mkdtempSync(join(tmpdir(), 'auralis-bench-'));
  const rssBefore = process.memoryUsage().rss;
  try {
    const kb = new KnowledgeBase(dir);
    const docsCount = 40;
    const indexStart = performance.now();
    for (let i = 1; i <= docsCount; i++) {
      kb.add({
        title: `Architecture Module ${i}`,
        path: `docs/module-${i}.md`,
        format: 'md',
        content: [
          `# Architecture Module ${i}`,
          `This module governs local inference budget ${i * 128} and enforces loopback 127.0.0.1 isolation.`,
          `## Hybrid Retrieval Engine ${i}`,
          `BM25 ranking combines inverse document frequency with phrase matching and line-range provenance citations.`,
          `## Memory Residency Profile`,
          `Apple Silicon unified memory budgets cap active model weights at 8 GiB with 2048 fast context tokens.`,
        ].join('\n\n'),
      });
    }
    const indexTotalMs = Math.round((performance.now() - indexStart) * 100) / 100;
    const stats = kb.stats();

    const queries = [
      'loopback 127.0.0.1 isolation',
      'BM25 ranking phrase matching citations',
      'Apple Silicon unified memory 8 GiB budget',
      'Architecture Module 24',
      'fast context tokens residency',
    ];
    const searchLatenciesMs: number[] = [];
    for (let round = 0; round < 20; round++) {
      const q = queries[round % queries.length];
      const t0 = performance.now();
      const hits = kb.search(q, 5);
      searchLatenciesMs.push(performance.now() - t0);
      if (hits.length === 0) throw new Error('Expected benchmark search hits');
    }
    searchLatenciesMs.sort((a, b) => a - b);

    // NDJSON stream framing benchmark
    const frameCount = 500;
    const payload = Array.from({ length: frameCount }, (_, i) => JSON.stringify({ type: 'token', text: `chunk_${i} ` })).join('\n') + '\n';
    const encoded = new TextEncoder().encode(payload);
    const streamStart = performance.now();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoded);
        c.close();
      },
    });
    let parsedFrames = 0;
    for await (const _packet of parseNDJSON(stream)) parsedFrames++;
    const streamFramingMs = Math.round((performance.now() - streamStart) * 100) / 100;

    // Calculator parser benchmark
    const calcStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      calculate(`(128 + ${i}) * 4 - (64 / 2)`);
    }
    const calcThousandMs = Math.round((performance.now() - calcStart) * 100) / 100;

    const rssAfter = process.memoryUsage().rss;
    return {
      benchmark: 'local-pipeline',
      documentsIndexed: stats.documentCount,
      chunksIndexed: stats.chunkCount,
      totalTokens: stats.totalTokens,
      indexTotalMs,
      indexDocsPerSec: Math.round((docsCount / (indexTotalMs / 1000)) * 10) / 10,
      retrievalLatencyMs: {
        p50: percentile(searchLatenciesMs, 50),
        p95: percentile(searchLatenciesMs, 95),
        max: percentile(searchLatenciesMs, 100),
      },
      ndjsonFraming: { frames: parsedFrames, totalMs: streamFramingMs },
      calculator1kOpsMs: calcThousandMs,
      memoryRssMB: Math.round((rssAfter / (1024 * 1024)) * 10) / 10,
      memoryDeltaMB: Math.round(((rssAfter - rssBefore) / (1024 * 1024)) * 100) / 100,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const localOnly = args.includes('--local-only');
  const modelArgs = args.filter(a => !a.startsWith('--'));

  const pipelineResult = await runLocalPipelineBenchmark();
  console.log(JSON.stringify(pipelineResult));

  if (localOnly) return;

  const config = configFromEnv();
  const provider = new Ollama(config.ollama);
  let installedModels: string[] = [];
  try {
    installedModels = await provider.models();
  } catch {
    console.log(JSON.stringify({ benchmark: 'ollama-inference', skipped: true, reason: 'Ollama is offline; ran deterministic local pipeline benchmark only.' }));
    return;
  }

  const models = modelArgs.length ? modelArgs : [config.model];
  const prompt = 'Explain why the sky appears blue in exactly two concise sentences.';
  for (const model of models) {
    if (!installedModels.includes(model)) {
      if (modelArgs.length > 0) {
        throw new Error(`${model} is not installed; benchmark never downloads models.`);
      }
      console.log(JSON.stringify({ benchmark: 'ollama-inference', model, skipped: true, reason: `${model} is not installed locally.` }));
      continue;
    }
    for (let trial = 1; trial <= 3; trial++) {
      const start = performance.now();
      let first: number | undefined;
      let count = 0;
      let duration = 0;
      let chars = 0;
      for await (const p of provider.chat(model, [{ role: 'user', content: prompt }], 2048, false, AbortSignal.timeout(180000))) {
        if (p.message?.content) {
          first ??= performance.now();
          chars += p.message.content.length;
        }
        if (p.done) {
          count = p.eval_count || 0;
          duration = p.eval_duration || 0;
        }
      }
      console.log(
        JSON.stringify({
          benchmark: 'ollama-inference',
          model,
          trial,
          context: 2048,
          ttftMs: first ? Math.round(first - start) : null,
          totalMs: Math.round(performance.now() - start),
          outputTokens: count,
          tokensPerSecond: duration ? +(count / (duration / 1e9)).toFixed(1) : null,
          chars,
        }),
      );
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
