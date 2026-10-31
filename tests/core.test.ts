import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculate } from '../server/calculator.ts';
import { loopbackEndpoint } from '../server/config.ts';
import { Store } from '../server/store.ts';
import { Proposals } from '../server/proposals.ts';
import { Ollama, parseNDJSON } from '../server/provider.ts';

test('calculator respects precedence, negatives and parentheses',()=>{
  assert.equal(calculate('(8 + 4) * 2 - 3 / 2'),22.5);
  assert.equal(calculate('-2 * -(3 + .5)'),7);
  assert.equal(calculate('11 % 3'),2);
});
test('calculator rejects execution, malformed and non-finite input',()=>{
  for(const value of ['process.exit()','1/0','(1+2','1 2','2**3','', '1+'.repeat(200)]) assert.throws(()=>calculate(value));
});
test('only numeric loopback endpoints without redirects or credentials are configurable',()=>{
  assert.equal(loopbackEndpoint('http://127.0.0.1:11434/'),'http://127.0.0.1:11434');
  for(const endpoint of ['https://api.example.com','http://localhost:8080','http://127.0.0.1.evil.com','file:///tmp/test','http://secret@127.0.0.1','http://127.0.0.1/?token=x']) assert.throws(()=>loopbackEndpoint(endpoint));
});
test('memory proposals require owner, expire, deny and cannot be replayed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'auralis-test-'));let now=1000;
  try {
    const store=new Store(dir);const proposals=new Proposals(store,()=>now);
    const args={title:'Private title',content:'Never put this secret in the audit'};
    const p=proposals.create('session-a',args);
    assert.equal(store.notes().length,0);
    assert.throws(()=>proposals.decide('session-b',p.id,true),/not found/);
    proposals.decide('session-a',p.id,true);
    assert.equal(store.notes().length,1);
    assert.throws(()=>proposals.decide('session-a',p.id,true),/not found/);
    const denied=proposals.create('session-a',args);proposals.decide('session-a',denied.id,false);
    const expired=proposals.create('session-a',args);now+=300001;
    assert.throws(()=>proposals.decide('session-a',expired.id,true),/expired/);
    assert.equal(store.notes().length,1);
    assert.equal(statSync(join(dir,'notes.json')).mode&0o777,0o600);
    assert.ok(!readFileSync(join(dir,'audit.jsonl'),'utf8').includes(args.content));
    assert.ok(store.delete(store.notes()[0].id));assert.equal(store.notes().length,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('NDJSON parser preserves split Unicode and final unterminated line',async()=>{
  const data=new TextEncoder().encode('{"x":"🌙"}\n{"done":true}');
  const stream=new ReadableStream<Uint8Array>({start(c){for(const byte of data)c.enqueue(Uint8Array.of(byte));c.close();}});
  const received=[];for await(const p of parseNDJSON(stream)) received.push(p);
  assert.deepEqual(received,[{x:'🌙'},{done:true}]);
});
test('provider encodes local bounded context, cancellation and no redirects',async()=>{
  const controller=new AbortController();let captured:RequestInit|undefined;
  const transport:typeof fetch=async(url,init)=>{
    if(String(url).endsWith('/api/tags'))return new Response('{"models":[{"name":"qwen3.5:4b"}]}');
    if(String(url).endsWith('/api/show'))return new Response('{"model_info":{"general.architecture":"qwen3_5"}}');
    captured=init;return new Response('{"message":{"content":"Hi"},"done":true}\n');
  };
  const provider=new Ollama('http://127.0.0.1:11434',transport);
  const packets=[];for await(const p of provider.chat('qwen3.5:4b',[{role:'user',content:'hello'}],2048,false,controller.signal))packets.push(p);
  const request=JSON.parse(captured?.body as string);
  assert.equal(request.options.num_ctx,2048);assert.equal(request.think,false);assert.equal(request.tools,undefined);
  assert.equal(captured?.redirect,'error');assert.equal(captured?.signal,controller.signal);assert.equal(packets.length,1);
});
