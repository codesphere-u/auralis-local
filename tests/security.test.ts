import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createApp } from '../server/app.ts';
import type { Config } from '../server/config.ts';
import { Ollama } from '../server/provider.ts';
import type { ChatMessage, Packet } from '../server/provider.ts';

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test('discovery filters cloud names and remote metadata without hiding downloaded models', async () => {
  const transport: typeof fetch = async () => jsonResponse({ models: [
    { name: 'qwen3.5:4b' },
    { name: 'local-copy:1b', remote_host: '', remote_model: null },
    { name: 'innocent-alias:1b', remote_host: 'https://remote.example' },
    { name: 'another-alias:1b', remote_model: 'server-model' },
    { name: 'large:cloud' },
    { name: 'large:32b-cloud' },
    { name: 'vendor/cloud/model' },
    { name: 'oversized:26b', size: 18_000_000_000 },
  ] });
  const provider = new Ollama('http://127.0.0.1:11434', transport);
  assert.deepEqual(await provider.models(), ['qwen3.5:4b', 'local-copy:1b']);
});

test('cloud names are denied before any transport and unknown aliases cannot reach chat', async () => {
  let calls = 0;
  const provider = new Ollama('http://127.0.0.1:11434', async () => {
    calls++;
    return jsonResponse({ models: [{ name: 'local:1b' }] });
  });
  await assert.rejects(provider.assertLocal('giant:cloud', new AbortController().signal), /blocked/);
  assert.equal(calls, 0);
  await assert.rejects(provider.assertLocal('unknown:1b', new AbortController().signal), /installed local/);
  assert.equal(calls, 1);
});

test('show metadata must verify local weights before a chat request can be sent', async t => {
  const cases = [
    { name: 'remote host alias', metadata: { remote_host: 'https://remote.example', model_info: { architecture: 'test' } } },
    { name: 'remote model alias', metadata: { remote_model: 'large', model_info: { architecture: 'test' } } },
    { name: 'empty model metadata', metadata: { model_info: {} } },
    { name: 'missing model metadata', metadata: {} },
    { name: 'malformed model metadata', metadata: { model_info: 'unverified' } },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const paths: string[] = [];
      const transport: typeof fetch = async (url) => {
        const path = new URL(String(url)).pathname; paths.push(path);
        if (path === '/api/tags') return jsonResponse({ models: [{ name: 'alias:1b' }] });
        if (path === '/api/show') return jsonResponse(item.metadata);
        throw new Error('Unverified model reached inference');
      };
      const provider = new Ollama('http://127.0.0.1:11434', transport);
      await assert.rejects(async () => {
        for await (const _packet of provider.chat('alias:1b', [{ role: 'user', content: 'hello' }], 2048, false, new AbortController().signal)) { /* consume */ }
      });
      assert.deepEqual(paths, ['/api/tags', '/api/show']);
    });
  }
});

test('verified local model reaches bounded inference with redirects disabled', async () => {
  const paths: string[] = [];
  const controller = new AbortController();
  const transport: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname; paths.push(path);
    assert.equal(init?.redirect, 'error');
    if (path === '/api/tags') return jsonResponse({ models: [{ name: 'local:1b' }] });
    assert.equal(init?.signal, controller.signal);
    if (path === '/api/show') return jsonResponse({ model_info: { 'general.architecture': 'test' } });
    const body = JSON.parse(init?.body as string);
    assert.equal(body.options.num_ctx, 2048);
    assert.equal(body.options.num_predict, 1024);
    return new Response('{"message":{"content":"Ready"},"done":true}\n');
  };
  const received: Packet[] = [];
  for await (const packet of new Ollama('http://127.0.0.1:11434', transport).chat('local:1b', [{ role: 'user', content: 'hello' }], 2048, false, controller.signal)) received.push(packet);
  assert.deepEqual(paths, ['/api/tags', '/api/show', '/api/chat']);
  assert.equal(received[0].message?.content, 'Ready');
});

type ChatScript = (model: string, messages: ChatMessage[], context: number, tools: boolean, signal: AbortSignal) => AsyncGenerator<Packet>;
class ScriptedProvider extends Ollama {
  constructor(private script: ChatScript) { super('http://127.0.0.1:11434'); }
  override async models() { return ['test:1b']; }
  override chat(model: string, messages: ChatMessage[], context: number, tools: boolean, signal: AbortSignal) {
    return this.script(model, messages, context, tools, signal);
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(t: test.TestContext, provider: Ollama) {
  const directory = mkdtempSync(join(tmpdir(), 'auralis-security-'));
  const config: Config = { port: 4317, dev: false, model: 'test:1b', ollama: 'http://127.0.0.1:11434', dataDir: directory, whisper: undefined };
  const app = createApp(config, provider);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address(); assert.ok(address && typeof address !== 'string');
  t.after(async () => {
    app.server.closeAllConnections();
    await new Promise<void>(resolve => app.server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  });
  const open = (path: string, method = 'GET', headers: OutgoingHttpHeaders = {}, body?: string) => {
    let client!: ReturnType<typeof httpRequest>;
    const response = new Promise<IncomingMessage>((resolve, reject) => {
      client = httpRequest({ hostname: '127.0.0.1', port: address.port, path, method, headers: { host: '127.0.0.1:4317', ...headers } }, resolve);
      client.on('error', reject); client.end(body);
    });
    return { client, response };
  };
  const request = async (path: string, method = 'GET', headers: OutgoingHttpHeaders = {}, body?: string) => {
    const response = await open(path, method, headers, body).response;
    const chunks: Buffer[] = [];
    for await (const chunk of response) chunks.push(Buffer.from(chunk));
    return { status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') };
  };
  const session = await request('/api/session');
  const cookie = session.headers['set-cookie']![0].split(';')[0];
  const headers = { cookie, origin: 'http://127.0.0.1:4317', 'x-auralis-csrf': JSON.parse(session.text).csrf as string, 'content-type': 'application/json' };
  const chatBody = JSON.stringify({ model: 'test:1b', messages: [{ role: 'user', content: 'hello' }], toolsEnabled: false });
  return { ...app, directory, open, request, headers, chatBody };
}

test('concurrent generation is denied and client cancellation releases the inference slot', { timeout: 10_000 }, async t => {
  const entered = deferred(); const cancelled = deferred(); let calls = 0;
  const provider = new ScriptedProvider(async function* (_model, _messages, _context, _tools, signal) {
    calls++;
    if (calls === 1) {
      entered.resolve();
      await new Promise<void>(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
      assert.equal(signal.aborted, true); cancelled.resolve(); return;
    }
    yield { message: { content: 'Available again' }, done: true };
  });
  const app = await fixture(t, provider);
  const first = app.open('/api/chat', 'POST', app.headers, app.chatBody);
  const firstResponse = await first.response;
  firstResponse.on('error', () => {}); firstResponse.resume();
  await entered.promise;
  const concurrent = await app.request('/api/chat', 'POST', app.headers, app.chatBody);
  assert.equal(concurrent.status, 429); assert.equal(calls, 1);
  first.client.destroy();
  await cancelled.promise; await nextTurn();
  const retry = await app.request('/api/chat', 'POST', app.headers, app.chatBody);
  assert.equal(retry.status, 200); assert.match(retry.text, /Available again/);
  assert.equal(calls, 2);
});

test('oversized provider output stops the stream and releases the inference slot', async t => {
  let calls = 0; let closed = false;
  const provider = new ScriptedProvider(async function* () {
    calls++;
    try { yield { message: { content: calls === 1 ? 'x'.repeat(262_145) : 'Within budget' }, done: true }; }
    finally { closed = true; }
  });
  const app = await fixture(t, provider);
  const overflow = await app.request('/api/chat', 'POST', app.headers, app.chatBody);
  const events = overflow.text.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(overflow.status, 200);
  assert.match(events.find(event => event.type === 'error').message, /Output limit/);
  assert.ok(!events.some(event => event.type === 'token'));
  assert.equal(events.at(-1).type, 'done'); assert.equal(closed, true);
  const retry = await app.request('/api/chat', 'POST', app.headers, app.chatBody);
  assert.match(retry.text, /Within budget/); assert.equal(calls, 2);
});

test('audit append failure preserves an approved note and reports degraded auditing', async t => {
  const app = await fixture(t, new ScriptedProvider(async function* () { yield { done: true }; }));
  // A directory in place of the log forces a deterministic append failure, even as an elevated test user.
  mkdirSync(join(app.directory, 'audit.jsonl'));
  const owner = app.headers.cookie.slice('auralis='.length);
  const proposal = app.proposals.create(owner, { title: 'Approved note', content: 'Must survive a failed audit append.' });
  const saved = await app.request('/api/proposals/' + proposal.id, 'POST', app.headers, '{"approve":true}');
  assert.equal(saved.status, 200); assert.match(saved.text, /Note saved/);
  assert.equal(app.store.notes().length, 1);
  assert.equal(app.store.notes()[0].content, 'Must survive a failed audit append.');
  assert.equal(app.store.auditHealthy, false);
  const health = await app.request('/api/health', 'GET', app.headers);
  assert.equal(JSON.parse(health.text).audit.available, false);
  assert.equal(JSON.parse(health.text).memory.count, 1);
  assert.equal((await app.request('/api/proposals/' + proposal.id, 'POST', app.headers, '{"approve":true}')).status, 409);
});
