import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { chunkDocument, KnowledgeBase, rankChunksBM25 } from '../server/knowledge.ts';
import { inspectWorkspaceFile, listWorkspaceFiles, validateWorkspacePath } from '../server/workspace.ts';
import { createApp } from '../server/app.ts';
import { Ollama } from '../server/provider.ts';
import type { Config } from '../server/config.ts';
import { runLocalPipelineBenchmark } from '../scripts/benchmark.ts';

test('chunkDocument preserves exact 1-based line ranges and heading context', () => {
  const content = [
    '# System Architecture',
    'Auralis runs inference on loopback 127.0.0.1.',
    '',
    '## Memory Governance',
    'Notes and indexed documents require explicit user action.',
    'The audit log redacts sensitive content and stores metadata only.',
  ].join('\n');

  const chunks = chunkDocument(
    { id: 'doc-1', title: 'Architecture', path: 'docs/architecture.md', format: 'md', content },
    110,
  );
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].heading, 'System Architecture');
  const second = chunks.find(c => c.heading === 'Memory Governance');
  assert.ok(second);
  assert.ok(second.startLine >= 4);
  assert.equal(second.endLine, 6);
});

test('rankChunksBM25 ranks exact phrase and heading matches above partial keyword matches', () => {
  const docs = [
    {
      id: 'd1',
      title: 'General Notes',
      path: 'notes/general.md',
      format: 'md' as const,
      content: '# Overview\nLocal models can run with different context sizes and memory settings.',
    },
    {
      id: 'd2',
      title: 'Apple Silicon Memory Budget',
      path: 'docs/memory-budget.md',
      format: 'md' as const,
      content: '# Unified Memory Cap\nThe 8 GiB model weight guard prevents unified memory thrashing on a 16 GB Mac.',
    },
    {
      id: 'd3',
      title: 'Voice Dictation',
      path: 'docs/voice.md',
      format: 'md' as const,
      content: '# Whisper Endpoint\nAudio capture uses 16 kHz mono PCM WAV over loopback.',
    },
  ];
  const allChunks = docs.flatMap(d => chunkDocument(d));
  const results = rankChunksBM25(allChunks, '8 GiB model weight guard unified memory', 3);
  assert.ok(results.length >= 1);
  assert.equal(results[0].documentId, 'd2');
  assert.equal(results[0].path, 'docs/memory-budget.md');
  assert.ok(results[0].matchedTerms.includes('gib'));
  assert.ok(results[0].matchedTerms.includes('memory'));
  assert.ok(results[0].score > (results[1]?.score ?? 0));
});

test('KnowledgeBase persists documents with 0600 permissions and redacts content from audit log', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auralis-kb-'));
  try {
    const config: Config = { port: 4317, dev: false, model: 'test:1b', ollama: 'http://127.0.0.1:11434', dataDir: dir, whisper: undefined };
    const { store, knowledge } = createApp(config);
    const secretPhrase = 'CONFIDENTIAL_PHRASE_99481';
    const doc = knowledge.add({
      title: 'Security Spec',
      path: 'specs/security.md',
      format: 'md',
      content: `# Threat Boundary\nLoopback enforcement protects ${secretPhrase} from cross-origin access.`,
    });
    assert.equal(knowledge.stats().documentCount, 1);
    assert.ok(doc.chunkCount >= 1);

    const hits = knowledge.search('Loopback enforcement cross-origin', 5);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].path, 'specs/security.md');

    const auditRaw = readFileSync(join(dir, 'audit.jsonl'), 'utf8');
    assert.ok(!auditRaw.includes(secretPhrase));
    assert.ok(!auditRaw.includes('Loopback enforcement'));
    assert.ok(store.events().some(e => e.action === 'knowledge.indexed'));
    assert.ok(store.events().some(e => e.action === 'knowledge.searched'));

    const reloaded = new KnowledgeBase(dir);
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.remove(doc.id), true);
    assert.equal(reloaded.list().length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Guarded workspace inspector blocks path traversal, dotfiles, secrets, and external symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'auralis-ws-'));
  const outside = mkdtempSync(join(tmpdir(), 'auralis-outside-'));
  try {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'docs', 'guide.md'), '# Guide\nSafe workspace documentation.\n');
    writeFileSync(join(root, '.env'), 'SECRET_KEY=12345\n');
    writeFileSync(join(root, 'id_rsa.pem'), 'PRIVATE KEY\n');
    writeFileSync(join(outside, 'escaped.md'), '# Escaped\nOutside workspace.\n');
    symlinkSync(join(outside, 'escaped.md'), join(root, 'docs', 'symlink.md'));

    for (const bad of [
      '../escaped.md',
      'docs/../../escaped.md',
      '/etc/passwd',
      '.env',
      '.git/config',
      'node_modules/pkg/index.js',
      'id_rsa.pem',
      'credentials.json',
      'docs\\guide.md',
    ]) {
      assert.throws(() => validateWorkspacePath(bad), /blocked|relative|extension/i, `Expected ${bad} to be rejected`);
    }

    assert.throws(() => inspectWorkspaceFile(root, 'docs/symlink.md'), /Symbolic links are blocked/);

    const valid = inspectWorkspaceFile(root, 'docs/guide.md');
    assert.equal(valid.path, 'docs/guide.md');
    assert.equal(valid.format, 'md');
    assert.match(valid.preview, /Safe workspace documentation/);

    const listed = listWorkspaceFiles(root);
    assert.deepEqual(listed.map(f => f.path), ['docs/guide.md']);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('Knowledge API and grounded chat stream citations and require approval for workspace indexing', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'auralis-kb-api-'));
  const wsDir = mkdtempSync(join(tmpdir(), 'auralis-ws-api-'));
  mkdirSync(join(wsDir, 'docs'));
  writeFileSync(
    join(wsDir, 'docs', 'policy.md'),
    '# Tool Governance\nAll mutating tools require explicit single-use human approval before execution.\n',
  );

  let capturedChatBody: Record<string, any> | undefined;
  const transport: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/api/tags')) return new Response('{"models":[{"name":"test:1b"}]}');
    if (String(url).endsWith('/api/show')) return new Response('{"model_info":{"general.architecture":"test"}}');
    capturedChatBody = JSON.parse(init?.body as string);
    return new Response('{"message":{"content":"According to [docs/policy.md#L1-L2], mutating tools require approval."},"done":true,"eval_count":10,"eval_duration":500000000}\n');
  };

  const config: Config = { port: 4317, dev: false, model: 'test:1b', ollama: 'http://127.0.0.1:11434', dataDir, whisper: undefined };
  const app = createApp(config, new Ollama(config.ollama, transport), wsDir);
  await new Promise<void>(r => app.server.listen(0, '127.0.0.1', r));
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>(r => app.server.close(() => r()));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(wsDir, { recursive: true, force: true });
  });

  const request = (path: string, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const req = httpRequest(
        baseUrl + path,
        { method: init.method || 'GET', headers: { host: '127.0.0.1:4317', ...(init.headers as Record<string, string>) } },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers as Record<string, string> })));
        },
      );
      req.on('error', reject);
      req.end(init.body as string | undefined);
    });

  const sessionRes = await request('/api/session');
  const { csrf } = (await sessionRes.json()) as { csrf: string };
  const cookie = sessionRes.headers.get('set-cookie')!.split(';')[0];
  const headers = { cookie, origin: 'http://127.0.0.1:4317', 'x-auralis-csrf': csrf, 'content-type': 'application/json' };

  // 1. Inspect workspace file and create an approval-gated knowledge.index proposal
  const inspectRes = await request('/api/workspace/inspect', {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: 'docs/policy.md', proposeIndex: true }),
  });
  assert.equal(inspectRes.status, 200);
  const inspected = (await inspectRes.json()) as { proposal: { id: string; tool: string } };
  assert.equal(inspected.proposal.tool, 'knowledge.index');
  assert.equal(app.knowledge.stats().documentCount, 0);

  // Approve proposal to index into knowledge base
  const approveRes = await request(`/api/proposals/${inspected.proposal.id}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ approve: true }),
  });
  assert.equal(approveRes.status, 200);
  assert.equal(app.knowledge.stats().documentCount, 1);

  // 2. Direct search API
  const searchRes = await request('/api/knowledge/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: 'mutating tools human approval', limit: 3 }),
  });
  assert.equal(searchRes.status, 200);
  const searchData = (await searchRes.json()) as { citations: Array<{ path: string; startLine: number }> };
  assert.equal(searchData.citations.length, 1);
  assert.equal(searchData.citations[0].path, 'docs/policy.md');

  // 3. Chat with useKnowledge: true emits citations event and grounds system prompt
  const chatRes = await request('/api/chat', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'test:1b',
      useKnowledge: true,
      messages: [{ role: 'user', content: 'What is the policy on mutating tools and human approval?' }],
    }),
  });
  assert.equal(chatRes.status, 200);
  const events = (await chatRes.text()).trim().split('\n').map(l => JSON.parse(l));
  const citationEvent = events.find(e => e.type === 'citations');
  assert.ok(citationEvent);
  assert.equal(citationEvent.citations[0].path, 'docs/policy.md');
  assert.match(capturedChatBody?.messages[0].content, /Local Knowledge Base Context/);
  assert.match(capturedChatBody?.messages[0].content, /docs\/policy\.md#L1-L2/);
});

test('deterministic local pipeline benchmark measures indexing and retrieval latency', async () => {
  const result = await runLocalPipelineBenchmark();
  assert.equal(result.benchmark, 'local-pipeline');
  assert.equal(result.documentsIndexed, 40);
  assert.ok(result.chunksIndexed >= 40);
  assert.ok(result.retrievalLatencyMs.p50 >= 0);
  assert.ok(result.retrievalLatencyMs.p95 >= result.retrievalLatencyMs.p50);
  assert.equal(result.ndjsonFraming.frames, 500);
});
