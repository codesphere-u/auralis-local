import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav } from '../src/voice.ts';
test('voice encoder produces mono 16kHz PCM WAV with clipped samples and accurate length',async()=>{
  const wav=encodeWav([Float32Array.from([-2,-1,0,1,2])],16000);
  const bytes=await wav.arrayBuffer();const view=new DataView(bytes);
  assert.equal(wav.type,'audio/wav');assert.equal(bytes.byteLength,54);
  assert.equal(Buffer.from(bytes).toString('ascii',0,4),'RIFF');
  assert.equal(Buffer.from(bytes).toString('ascii',8,12),'WAVE');
  assert.equal(view.getUint32(4,true),46);assert.equal(view.getUint16(22,true),1);
  assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(34,true),16);
  assert.equal(view.getUint32(40,true),10);
  assert.deepEqual([0,1,2,3,4].map(i=>view.getInt16(44+i*2,true)),[-32768,-32768,0,32767,32767]);
});
test('voice encoder resamples 48kHz input into the expected16kHz duration',async()=>{
  const bytes=await encodeWav([new Float32Array(24000),new Float32Array(24000)],48000).arrayBuffer();
  assert.equal(bytes.byteLength,44+16000*2);assert.equal(new DataView(bytes).getUint32(40,true),32000);
});
