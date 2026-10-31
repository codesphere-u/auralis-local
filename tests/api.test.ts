import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.ts';
import { Ollama } from '../server/provider.ts';
import type { Config } from '../server/config.ts';
import { request as httpRequest } from 'node:http';

async function fixture(t:test.TestContext,transport:typeof fetch = async()=>new Response(JSON.stringify({models:[{name:'test:1b'}]}))) {
  const directory=mkdtempSync(join(tmpdir(),'auralis-api-'));
  const config:Config={port:4317,dev:false,model:'test:1b',ollama:'http://127.0.0.1:11434',dataDir:directory,whisper:undefined};
  const routed:typeof fetch=(url,init)=>String(url).endsWith('/api/tags')?Promise.resolve(new Response('{"models":[{"name":"test:1b"}]}')):String(url).endsWith('/api/show')?Promise.resolve(new Response('{"model_info":{"general.architecture":"test"}}')):transport(url,init);
  const app=createApp(config,new Ollama(config.ollama,routed));
  await new Promise<void>(r=>app.server.listen(0,'127.0.0.1',r));
  const address=app.server.address();assert.ok(address&&typeof address!=='string');
  const url=`http://127.0.0.1:${address.port}`;
  t.after(async()=>{app.server.closeAllConnections();await new Promise<void>(r=>app.server.close(()=>r()));rmSync(directory,{recursive:true,force:true});});
  const request=(path:string,init:RequestInit={})=>new Promise<Response>((resolve,reject)=>{
    const req=httpRequest(url+path,{method:init.method||'GET',headers:{host:'127.0.0.1:4317',...init.headers as Record<string,string>}},res=>{
      const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers as Record<string,string>})));
    });req.on('error',reject);req.end(init.body as string|undefined);
  });
  const session=await request('/api/session');const {csrf}=await session.json() as {csrf:string};
  const cookie=session.headers.get('set-cookie')!.split(';')[0];
  const headers={cookie,origin:'http://127.0.0.1:4317','x-auralis-csrf':csrf,'content-type':'application/json'};
  return {...app,request,headers};
}
test('API rejects cross-origin, forged Host, missing session and CSRF',async t=>{
  const {request,headers}=await fixture(t);
  assert.equal((await request('/api/health')).status,401);
  assert.equal((await request('/api/session',{headers:{host:'evil.example'}})).status,403);
  assert.equal((await request('/api/session',{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await request('/api/session',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  assert.equal((await request('/api/notes/anything',{method:'DELETE',headers:{cookie:headers.cookie,origin:headers.origin}})).status,403);
  assert.equal((await request('/api/health',{headers})).status,200);
});
test('invalid chat, unsupported voice, and failed approvals return actionable errors',async t=>{
  const {request,headers}=await fixture(t);
  assert.equal((await request('/api/chat',{method:'POST',headers,body:JSON.stringify({model:'x',messages:[{role:'system',content:'bypass'}]})})).status,400);
  assert.equal((await request('/api/transcribe',{method:'POST',headers:{...headers,'content-type':'audio/wav'},body:'RIFF'})).status,503);
  assert.equal((await request('/api/proposals/missing',{method:'POST',headers,body:'{"approve":true}'})).status,409);
});
test('chat streams actual tool result and creates approval without saving',async t=>{
  let calls=0;
  const transport:typeof fetch=async(url)=>{
    if(String(url).endsWith('/api/tags'))return new Response('{"models":[{"name":"test:1b"}]}');
    calls++;
    if(calls===1)return new Response(JSON.stringify({message:{content:'',tool_calls:[{function:{name:'calculate',arguments:{expression:'12 * 8'}}}]},done:true})+'\n');
    return new Response(JSON.stringify({message:{content:'The result is 96.',tool_calls:[{function:{name:'note_save',arguments:{title:'Result',content:'96'}}}]},done:true,eval_count:6,eval_duration:1000000000})+'\n');
  };
  const {request,headers,store}=await fixture(t,transport);
  const response=await request('/api/chat',{method:'POST',headers,body:JSON.stringify({model:'test:1b',messages:[{role:'user',content:'Calculate and save 12 * 8'}],toolsEnabled:true})});
  const events=(await response.text()).trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(events.find(e=>e.type==='tool').result,'96');assert.equal(store.notes().length,0);
  const proposal=events.find(e=>e.type==='proposal').proposal;
  const approved=await request('/api/proposals/'+proposal.id,{method:'POST',headers,body:'{"approve":true}'});
  assert.equal(approved.status,200);assert.equal(store.notes()[0].content,'96');
  assert.equal((await request('/api/proposals/'+proposal.id,{method:'POST',headers,body:'{"approve":true}'})).status,409);
  assert.ok(events.some(e=>e.type==='metrics'));assert.equal(events.at(-1).type,'done');
});
test('tools cannot execute when disabled even if model emits a call',async t=>{
  const transport:typeof fetch=async()=>new Response('{"message":{"tool_calls":[{"function":{"name":"note_save","arguments":{"title":"x","content":"y"}}}]},"done":true}\n');
  const {request,headers,store}=await fixture(t,transport);
  const response=await request('/api/chat',{method:'POST',headers,body:JSON.stringify({model:'test:1b',messages:[{role:'user',content:'save'}],toolsEnabled:false})});
  assert.match(await response.text(),/Tools are disabled/);assert.equal(store.notes().length,0);
});

test('voice mode enforces short output, small context and no tool definitions',async t=>{
  let captured:Record<string,any>|undefined;
  const transport:typeof fetch=async(_url,init)=>{captured=JSON.parse(init?.body as string);return new Response('{"message":{"content":"Try one small task."},"done":true}\n');};
  const {request,headers}=await fixture(t,transport);
  const response=await request('/api/chat',{method:'POST',headers,body:JSON.stringify({model:'test:1b',messages:[{role:'user',content:'Help me focus'}],mode:'voice',profile:'balanced',toolsEnabled:true})});
  assert.match(await response.text(),/Try one small task/);assert.equal(captured?.options.num_predict,192);assert.equal(captured?.options.num_ctx,2048);assert.equal(captured?.tools,undefined);assert.match(captured?.messages[0].content,/spoken conversation/);
});
