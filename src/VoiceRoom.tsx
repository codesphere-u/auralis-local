import { useEffect, useRef, useState } from 'react';
import { AudioLines, Check, ChevronDown, Mic, MicOff, PhoneOff, ShieldCheck, Square, Volume2, X } from 'lucide-react';
import { startCapture, type Capture } from './voice';
import { SentenceSpeaker } from './speech';

type Message = {role:'user'|'assistant';content:string};
type Phase = 'ready'|'opening'|'listening'|'transcribing'|'thinking'|'speaking'|'paused';
type Props = {
  request:(path:string,init?:RequestInit)=>Promise<Response>;
  models:string[]; model:string; configured:boolean;
  history:Message[]; onTurn:(user:string,answer:string)=>void; onClose:()=>void;
};
const labels:Record<Phase,string> = {ready:'A little closer.',opening:'Opening the microphone…',listening:'I’m listening.',transcribing:'Finding your words…',thinking:'Let me think…',speaking:'Let’s talk.',paused:'Take your time.'};
export default function VoiceRoom({request,models,model:initialModel,configured,history,onTurn,onClose}:Props) {
  const [phase,setPhase]=useState<Phase>('ready');
  const [model,setModel]=useState(models.includes('qwen3.5:2b')?'qwen3.5:2b':initialModel);
  const [voices,setVoices]=useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI,setVoiceURI]=useState('');
  const [rate,setRate]=useState(1.08);
  const [handsFree,setHandsFree]=useState(true);
  const [level,setLevel]=useState(0);
  const [question,setQuestion]=useState('');
  const [answer,setAnswer]=useState('');
  const [error,setError]=useState('');
  const [elapsed,setElapsed]=useState(0);
  const alive=useRef(true); const epoch=useRef(0); const active=useRef(false);
  const capture=useRef<Capture|null>(null); const controller=useRef<AbortController|null>(null);
  const speaker=useRef<SentenceSpeaker|null>(null); const pending=useRef(false);
  const historyRef=useRef(history.slice(-12));
  const handsRef=useRef(handsFree);handsRef.current=handsFree;
  const nextListen=useRef<()=>Promise<void>>(async()=>{});
  const finishListen=useRef<(speech:boolean)=>Promise<void>>(async()=>{});
  const closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setModel(current=>models.includes(current)?current:models.includes('qwen3.5:2b')?'qwen3.5:2b':models[0]||'');},[models]);

  function stop(next:Phase='paused') {
    epoch.current++;active.current=false;
    capture.current?.dispose();capture.current=null;
    controller.current?.abort();controller.current=null;
    speaker.current?.cancel();speaker.current=null;
    if(alive.current){setLevel(0);setPhase(next);}
  }
  useEffect(()=>{
    alive.current=true;const focused=document.activeElement as HTMLElement|null;closeButton.current?.focus();
    const update=()=>{
      const available=window.speechSynthesis?.getVoices().filter(v=>v.localService)||[];setVoices(available);
      setVoiceURI(current=>available.some(v=>v.voiceURI===current)?current:(available.find(v=>v.lang.startsWith('en'))||available[0])?.voiceURI||'');
    };
    update();window.speechSynthesis?.addEventListener('voiceschanged',update);
    const visibility=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',visibility);
    return ()=>{alive.current=false;stop();window.speechSynthesis?.removeEventListener('voiceschanged',update);document.removeEventListener('visibilitychange',visibility);focused?.focus();};
  },[]);
  useEffect(()=>{
    if(phase!=='listening')return;setElapsed(0);const started=Date.now();
    const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);
  },[phase]);
  async function listen() {
    if(pending.current||capture.current)return;
    if(!configured){setError('Set up local dictation first. Run npm run voice:setup, then npm run voice:start, and start Auralis with WHISPER_URL=http://127.0.0.1:8080/inference.');return;}
    if(!voices.length){setError('An installed local speech voice is needed. Open this app in Safari or Chrome and add a voice in macOS Spoken Content settings.');return;}
    if(!model){setError('Connect a local language model first.');return;}
    stop('opening');const turn=epoch.current;pending.current=true;active.current=true;setError('');
    try {
      const stream=await startCapture({onLevel:value=>{if(alive.current&&turn===epoch.current)setLevel(value);},onEnd:speech=>void finishListen.current(speech)});
      if(!alive.current||turn!==epoch.current||document.hidden){stream.dispose();return;}
      capture.current=stream;setPhase('listening');
    } catch(cause) {if(alive.current&&turn===epoch.current){active.current=false;setError(`Microphone unavailable: ${(cause as Error).message}`);setPhase('ready');}}
    finally{pending.current=false;}
  }
  nextListen.current=listen;
  async function transcribe(speech:boolean) {
    const recording=capture.current;if(!recording)return;capture.current=null;setLevel(0);
    if(!speech){recording.dispose();active.current=false;setPhase('ready');setError('No speech detected. Tap the microphone and try again.');return;}
    const turn=epoch.current;const abort=new AbortController();controller.current=abort;
    const current=()=>alive.current&&turn===epoch.current&&!abort.signal.aborted;
    let user='';let reply='';let saved=false;
    const save=()=>{if(saved||!user)return;saved=true;historyRef.current.push({role:'user',content:user});if(reply)historyRef.current.push({role:'assistant',content:reply});onTurn(user,reply);};
    try {
      setPhase('transcribing');const wav=await recording.finish();
      const response=await request('/api/transcribe',{method:'POST',signal:abort.signal,headers:{'Content-Type':'audio/wav'},body:wav});
      const result=await response.json();if(!current())return;
      user=String(result.text||'').trim();if(!user)throw new Error('No clear words detected. Try again in a quieter room.');
      if(user.length>16000)throw new Error('That turn was too long. Please try a shorter thought.');
      setQuestion(user);setAnswer('');setPhase('thinking');
      const voice=voices.find(v=>v.voiceURI===voiceURI)||voices[0];
      const speechQueue=new SentenceSpeaker(voice,rate,speaking=>{if(current())setPhase(speaking?'speaking':'thinking');},()=>{if(current()){stop('ready');setError('Speech playback was blocked or timed out. Tap to start again, or choose a different installed voice.');}});speaker.current=speechQueue;
      const messages=[...historyRef.current.slice(-10),{role:'user' as const,content:user}].map(m=>({...m,content:m.content.slice(-4000)}));
      const chat=await request('/api/chat',{method:'POST',signal:abort.signal,body:JSON.stringify({model,messages,profile:'fast',toolsEnabled:false,mode:'voice'})});
      if(!chat.body)throw new Error('Streaming is unavailable in this browser.');
      const reader=chat.body.getReader();const decoder=new TextDecoder();let buffer='';let completed=false;
      const consume=(line:string)=>{
        if(!line.trim())return;const packet=JSON.parse(line);
        if(packet.type==='error')throw new Error(packet.message);
        if(packet.type==='token'&&current()){reply+=packet.text;setAnswer(reply);speechQueue.push(packet.text);}
        if(packet.type==='done')completed=true;
      };
      try {while(current()){
        const {done,value}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
        let end:number;while((end=buffer.indexOf('\n'))>=0){consume(buffer.slice(0,end));buffer=buffer.slice(end+1);}
        if(done){if(buffer.trim())consume(buffer);break;}
      }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      if(!current())return;if(!completed)throw new Error('The connection ended early. Tap to try another turn.');
      save();await speechQueue.finish();if(!current())return;
      speaker.current=null;controller.current=null;setPhase('ready');
      if(active.current&&handsRef.current&&!document.hidden)void nextListen.current();else active.current=false;
    }catch(cause){
      if(user)save();
      if(current()){speaker.current?.cancel();active.current=false;setPhase('ready');setError((cause as Error).message);}
    }
  }
  finishListen.current=transcribe;
  const inTurn=phase==='transcribing'||phase==='thinking'||phase==='speaking';
  return <div className={`voice-room phase-${phase}`} role="dialog" aria-modal="true" aria-labelledby="voice-title" onKeyDown={event=>{
    if(event.key==='Escape'){event.stopPropagation();stop();onClose();}
    if(event.key==='Tab'){
      const controls=event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)');
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  }}>
    <header className="voice-header"><span className="voice-wordmark"><AudioLines size={23}/> auralis<span>.</span></span><span className="voice-private"><ShieldCheck size={13}/> ON YOUR MAC</span><button ref={closeButton} className="voice-close" aria-label="Close voice conversation" onClick={()=>{stop();onClose();}}><X size={21}/></button></header>
    <div className="voice-options"><label><Sparkle/> <select aria-label="Voice conversation model" value={model} disabled={phase!=='ready'&&phase!=='paused'} onChange={e=>setModel(e.target.value)}>{models.map(m=><option key={m}>{m}</option>)}</select><ChevronDown size={12}/></label><label><Volume2 size={13}/><select aria-label="Speaking voice" value={voiceURI} onChange={e=>setVoiceURI(e.target.value)} disabled={inTurn}>{voices.map(v=><option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}</select></label><select aria-label="Speech speed" value={rate} onChange={e=>setRate(Number(e.target.value))} disabled={inTurn}><option value={0.9}>Gentle · 0.9×</option><option value={1.08}>Natural · 1.08×</option><option value={1.25}>Quick · 1.25×</option></select></div>
    <main className="voice-stage">
      <div className="voice-orb-wrap" aria-hidden="true"><div className="voice-orb-glow"/><div className="voice-ring ring-a"/><div className="voice-ring ring-b"/><div className="voice-sphere"><div/><i/></div><span className="voice-spark spark-a"/><span className="voice-spark spark-b"/></div>
      <div className="voice-state" role="status"><span/>{phase==='listening'?`LISTENING · ${elapsed}s`:phase==='speaking'?'SPEAKING LOCALLY':phase==='thinking'?'THINKING ON YOUR MAC':phase==='transcribing'?'LOCAL TRANSCRIPTION':'VOICE CONVERSATION'}</div>
      <h1 id="voice-title">{labels[phase]}</h1><p className="voice-subtitle">{phase==='listening'?'Say what’s on your mind. A pause sends your words.':phase==='speaking'?'You can interrupt me whenever you like.':phase==='ready'&&!question?'A thought, a question, a conversation. Just us and your Mac.':'There’s room for your next thought.'}</p>
      <div className="voice-wave" aria-hidden="true">{Array.from({length:25},(_,i)=><i key={i} style={{height:`${phase==='listening'?5+level*60*(0.35+Math.sin(i*1.7)**2):phase==='speaking'?12+Math.sin(i*1.3)**2*18:4}px`,animationDelay:`${i*45}ms`}}/>)}</div>
      <div className="voice-captions" aria-label="Live conversation captions">{question&&<p className="voice-question"><span>YOU</span>{question}</p>}{answer&&<p className="voice-answer"><span>AURALIS</span>{answer}</p>}</div>
      {error&&<p className="voice-error" role="alert">{error}</p>}
      {!configured&&<div className="voice-setup"><strong>One small setup, then we can talk.</strong><p>Install local dictation with <code>npm run voice:setup</code>. Follow the voice guide to start it. No cloud speech service is used.</p></div>}
    </main>
    <footer className="voice-controls"><div className="voice-control-row"><button className="voice-secondary" aria-label="Pause voice conversation" onClick={()=>stop()} disabled={phase==='ready'||phase==='paused'}><MicOff size={19}/></button><button className={`voice-main ${phase==='listening'?'listening':''}`} disabled={pending.current} aria-label={phase==='listening'?'Finish speaking':inTurn?'Interrupt and speak':'Start voice conversation'} onClick={()=>{if(phase==='listening')void transcribe(true);else void listen();}}>{phase==='listening'?<Square size={22}/>:inTurn?<AudioLines size={27}/>:<Mic size={26}/>}</button><button className="voice-secondary end" aria-label="End voice conversation" onClick={()=>{stop();onClose();}}><PhoneOff size={19}/></button></div><strong>{phase==='listening'?'Listening · tap to send':inTurn?'Tap to interrupt':'Tap to start talking'}</strong><label className="voice-handsfree"><input type="checkbox" checked={handsFree} onChange={e=>setHandsFree(e.target.checked)}/><Check size={12}/> Continue listening after each reply</label><p><ShieldCheck size={12}/> Microphone off while Auralis speaks. Leaving this screen stops voice.</p></footer>
  </div>;
}
function Sparkle(){return <span aria-hidden="true">✧</span>;}
