import test from 'node:test';
import assert from 'node:assert/strict';
import { SentenceBuffer, SentenceSpeaker, spokenText } from '../src/speech.ts';
import { TurnDetector } from '../src/voice.ts';

test('sentence streaming preserves split fragments, decimals and final remainder',()=>{
 const b=new SentenceBuffer();assert.deepEqual(b.push('It costs 2.'),[]);assert.deepEqual(b.push('5 dollars. '),['It costs 2.5 dollars.']);
 assert.deepEqual(b.push('How are'),[]);assert.deepEqual(b.push(' you? Next'),['How are you?']);assert.deepEqual(b.push('',true),['Next']);assert.deepEqual(b.push('',true),[]);
});
test('sentence streaming bounds long unpunctuated chunks and removes markdown from speech',()=>{
 const b=new SentenceBuffer();const chunks=b.push('word '.repeat(50));assert.ok(chunks.length>0);assert.ok(chunks[0].length<=160);
 assert.equal(spokenText('**Hello** `friend` https://example.com'), 'Hello friend the linked address');
});
test('turn detector requires sustained speech and ends only after a pause',()=>{
 const d=new TurnDetector();assert.equal(d.update(.05,100),undefined);assert.equal(d.update(0,100),undefined);assert.equal(d.speech,false);
 d.update(.05,250);assert.equal(d.speech,true);assert.equal(d.update(0,900),undefined);assert.equal(d.update(.05,100),undefined);assert.equal(d.update(0,950),'speech');
});
test('turn detector does not send silence and enforces the recording cap',()=>{
 const silent=new TurnDetector();assert.equal(silent.update(0,7000),'silence');assert.equal(silent.speech,false);
 const long=new TurnDetector();assert.equal(long.update(.05,30000),'limit');
});
test('speech queue streams in order, finishes, and cancellation ignores stale callbacks',async()=>{
 const g=globalThis as unknown as {window:unknown;SpeechSynthesisUtterance:unknown};
 const oldWindow=g.window, oldUtterance=g.SpeechSynthesisUtterance;
 class FakeUtterance {onstart?:()=>void;onend?:()=>void;onerror?:()=>void;voice:unknown;rate=1;constructor(public text:string){}}
 const played:FakeUtterance[]=[];let cancels=0;const states:boolean[]=[];
 g.window={speechSynthesis:{speak:(u:FakeUtterance)=>{played.push(u);u.onstart?.();},cancel:()=>cancels++}};g.SpeechSynthesisUtterance=FakeUtterance;
 try {
   const q=new SentenceSpeaker({} as SpeechSynthesisVoice,1,s=>states.push(s));q.push('First. Second. ');assert.equal(played.length,1);played[0].onend?.();assert.equal(played[1].text,'Second.');
   const finished=q.finish();played[1].onend?.();await finished;assert.equal(states.at(-1),false);
   q.push('Third. Fourth. ');const stale=played[2];const cancelled=q.finish();q.cancel();await cancelled;stale.onend?.();assert.equal(played.length,3);assert.equal(cancels,1);
 }finally{g.window=oldWindow;g.SpeechSynthesisUtterance=oldUtterance;}
});
