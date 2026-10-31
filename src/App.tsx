import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpRight, AudioLines, BookOpen,
  Check, ChevronDown, CircleHelp, FileText, Loader2, MessageSquare,
  Mic, PanelLeftOpen, Plus, RefreshCw, Settings2, ShieldCheck,
  Sparkles, Square, Trash2, Wrench, X, Zap, Volume2, VolumeX,
} from 'lucide-react';
import { startCapture, type Capture } from './voice';
import VoiceRoom from './VoiceRoom';
import { SentenceSpeaker } from './speech';

type Page = 'conversation' | 'memory' | 'tools' | 'settings';
type Message = { id: string; role: 'user' | 'assistant'; content: string };
type Note = { id: string; title: string; content: string; createdAt: string };
type Audit = { id: string; at: string; action: string; detail: string };
type Proposal = { id: string; tool: string; args: { title: string; content: string }; expiresAt: number };
type Health = {
  status: string; provider: { connected: boolean; models: string[]; error?: string };
  voice: { configured: boolean }; memory: { count: number }; audit?: { available: boolean }; activeModel: string;
};
type Metrics = { ttftMs: number | null; totalMs: number; tokensPerSecond?: number; outputTokens?: number };
type Event = { type: string; text?: string; message?: string; name?: string; result?: string; proposal?: Proposal } & Partial<Metrics>;
const pages = [
  { id: 'conversation', label: 'Conversation', icon: MessageSquare },
  { id: 'memory', label: 'Memory', icon: BookOpen },
  { id: 'tools', label: 'Tool library', icon: Wrench },
  { id: 'settings', label: 'Preferences', icon: Settings2 },
] as const;
const starters = [
  { icon: Sparkles, tag: 'EXPLORE', title: 'Untangle an idea', prompt: 'Help me think through an idea. Ask me one thoughtful question to get started.' },
  { icon: FileText, tag: 'CREATE', title: 'Find the right words', prompt: 'Help me write something clear and memorable. First ask what I am writing and who it is for.' },
  { icon: Zap, tag: 'FOCUS', title: 'Make a little progress', prompt: 'Help me turn a task I am avoiding into a small, manageable next step.' },
];
const uid = () => crypto.randomUUID();
function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><i /><i /><i /></span>;
}
function Orb({ active, recording = false }: { active: boolean; recording?: boolean }) {
  return <div className={`orb-scene ${active ? 'active' : ''} ${recording ? 'recording' : ''}`} aria-hidden="true">
    <div className="orb-halo" /><div className="orbit orbit-one" /><div className="orbit orbit-two" />
    <div className="orb"><div className="orb-core" /><div className="orb-contour" /><div className="orb-shine" /></div>
    <div className="orb-star star-one" /><div className="orb-star star-two" />
  </div>;
}
function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button type="button" className={`toggle ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={onChange} disabled={disabled}><span /></button>;
}

export default function App() {
  const [page, setPage] = useState<Page>('conversation');
  const [sidebar, setSidebar] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [model, setModel] = useState('');
  const [profile, setProfile] = useState<'fast' | 'balanced'>('fast');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [speak, setSpeak] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const speechQueue = useRef<SentenceSpeaker | null>(null);
  const [speechActive, setSpeechActive] = useState(false);
  const [localVoice, setLocalVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [decision, setDecision] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [startingRecording, setStartingRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [apiReady, setApiReady] = useState(false);
  const csrf = useRef('');
  const sessionPromise = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const captureGeneration = useRef(0);
  const capturePending = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const capture = useRef<Capture | null>(null);
  const recordTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollEnd = useRef<HTMLDivElement>(null);
  const speaking = useRef(false);
  const streamFrame = useRef<number | null>(null);
  const followTail = useRef(true);
  const navigation = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  const session = useCallback(async () => {
    if (sessionPromise.current) return sessionPromise.current;
    const pending = (async () => {
      const response = await fetch('/api/session', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('The local assistant service is unavailable. Start Auralis and refresh.');
      const data = await response.json(); csrf.current = data.csrf; setApiReady(true);
    })();
    sessionPromise.current = pending;
    try { await pending; } finally { sessionPromise.current = null; }
  }, []);
  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!csrf.current) await session();
    const response = await fetch(path, {
      ...init, credentials: 'same-origin',
      headers: { ...(init.body instanceof Blob ? {} : { 'Content-Type': 'application/json' }), 'x-auralis-csrf': csrf.current, ...init.headers },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || body?.message || `The local service returned ${response.status}.`);
    }
    return response;
  }, [session]);
  const refresh = useCallback(async () => {
    try {
      const response = await request('/api/health');
      if (!response.ok) throw new Error('Could not connect to the local service.');
      const data: Health = await response.json(); setHealth(data);
      setModel(current => data.provider.models.includes(current) ? current : data.provider.models.includes(data.activeModel) ? data.activeModel : data.provider.models[0] || '');
    } catch { setHealth(null); }
  }, [request]);
  const loadNotes = useCallback(async () => {
    try { const response = await request('/api/notes'); setNotes((await response.json()).notes); }
    catch (cause) { setError((cause as Error).message); }
  }, [request]);
  const loadAudit = useCallback(async () => {
    try { const response = await request('/api/audit'); setAudit((await response.json()).events); }
    catch (cause) { setError((cause as Error).message); }
  }, [request]);

  useEffect(() => {
    void session().then(refresh).catch(cause => setError(cause.message));
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => clearInterval(timer);
  }, [session, refresh]);
  useEffect(() => {
    if (page === 'memory') void loadNotes();
    if (page === 'tools') void loadAudit();
  }, [page, loadNotes, loadAudit]);
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setLocalVoice(window.speechSynthesis.getVoices().find(voice => voice.localService && voice.lang.startsWith('en')) || window.speechSynthesis.getVoices().find(voice => voice.localService) || null);
    update(); window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);
  useEffect(() => { if (followTail.current) scrollEnd.current?.scrollIntoView({ behavior: 'instant', block: 'end' }); }, [messages, proposals, busy]);
  useEffect(() => {
    if (!sidebar) return;
    navigation.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => menuButton.current?.focus();
  }, [sidebar]);
  useEffect(() => {
    mounted.current = true;
    const hidden = () => {
      if (!document.hidden) return;
      captureGeneration.current++;
      if (capture.current) {
        capture.current.dispose(); capture.current = null; setRecording(false);
        if (recordTimer.current) clearInterval(recordTimer.current);
        setError('Recording stopped when Auralis went into the background. Your audio was discarded.');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      speechQueue.current?.cancel();
      mounted.current = false; captureGeneration.current++;
      abort.current?.abort(); capture.current?.dispose();
      if (streamFrame.current !== null) cancelAnimationFrame(streamFrame.current);
      if (recordTimer.current) clearInterval(recordTimer.current);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') { event.preventDefault(); setPage('conversation'); composer.current?.focus(); }
      if (event.key === 'Escape') { if (sidebar) setSidebar(false); else if (busy) abort.current?.abort(); }
    };
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, [busy, sidebar]);

  function stopSpeech() { speechQueue.current?.cancel(); speechQueue.current = null; window.speechSynthesis?.cancel(); setSpeechActive(false); }
  function say(text: string) {
    if (!localVoice || !text) return;
    stopSpeech(); const queue = new SentenceSpeaker(localVoice, 1.08, setSpeechActive);
    speechQueue.current = queue; queue.push(text); void queue.finish();
  }
  function openVoice() {
    stopSpeech(); captureGeneration.current++; capture.current?.dispose(); capture.current = null;
    setRecording(false); if(recordTimer.current) clearInterval(recordTimer.current); setVoiceOpen(true);
  }
  async function send(event?: FormEvent) {
    event?.preventDefault();
    const content = input.trim(); if (!content || busy || recording || transcribing || startingRecording) return;
    const outgoing = [...messages.map(({ role, content }) => ({ role, content })), { role: 'user', content }];
    if (content.length > 16000) { setError('Please keep each message under 16,000 characters. Your draft is still here.'); return; }
    if (outgoing.length > 40 || outgoing.some(message => message.content.length > 16000) || outgoing.reduce((total, message) => total + message.content.length, 0) > 64000) {
      setError('This conversation has reached the local context limit. Export it if you want a copy, then start a new conversation. Your draft is still here.'); return;
    }
    if (!model) { setError('Connect Ollama and choose an installed model to start a conversation.'); return; }
    followTail.current = true;
    setError(''); setMetrics(null); setInput(''); setBusy(true); setStatus('Connecting to your model');
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    const history: Message[] = [...messages, { id: uid(), role: 'user', content }];
    const answerId = uid(); setMessages([...history, { id: answerId, role: 'assistant', content: '' }]);
    const controller = new AbortController(); abort.current = controller;
    const spoken = speak && localVoice ? new SentenceSpeaker(localVoice, 1.08, setSpeechActive) : null;
    speechQueue.current?.cancel(); speechQueue.current = spoken;
    let answer = ''; let receivedAction = false; let answerDirty = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const publishAnswer = () => {
      if (streamFrame.current !== null) cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
      if (!answerDirty || !mounted.current) return;
      answerDirty = false; const content = answer;
      setMessages(current => current.map(message => message.id === answerId ? { ...message, content } : message));
    };
    try {
      const response = await request('/api/chat', { method: 'POST', signal: controller.signal,
        body: JSON.stringify({ model, profile, toolsEnabled, messages: history.map(({ role, content }) => ({ role, content })) }),
      });
      if (!response.body) throw new Error('This browser cannot read a streaming response.');
      reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event: Event = JSON.parse(line);
        if (event.type === 'token') {
          if (!receivedAction) setStatus('Thinking with you');
          receivedAction = true; answer += event.text || ''; answerDirty = true; spoken?.push(event.text || '');
          if (streamFrame.current === null) streamFrame.current = requestAnimationFrame(publishAnswer);
        }
        if (event.type === 'status') setStatus(event.text || 'Working locally');
        if (event.type === 'metrics') setMetrics({ ttftMs: event.ttftMs ?? null, totalMs: event.totalMs || 0, tokensPerSecond: event.tokensPerSecond, outputTokens: event.outputTokens });
        if (event.type === 'proposal' && event.proposal) { receivedAction = true; setProposals(current => [...current, event.proposal!]); }
        if (event.type === 'tool') setStatus(`${event.name || 'Tool'} completed`);
        if (event.type === 'error') throw new Error(event.message || 'The model could not complete this request.');
      };
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); consume(line); }
        if (done) { if (buffer.trim()) consume(buffer); break; }
      }
      publishAnswer(); setStatus(''); void spoken?.finish();
    } catch (cause) {
      spoken?.cancel();
      if ((cause as Error).name === 'AbortError') setStatus('Response stopped');
      else { setError((cause as Error).message); setStatus(''); }
      if (!answer && !receivedAction) { setMessages(current => current.filter(message => message.id !== answerId && message.id !== history[history.length - 1].id)); setInput(current => current || content); }
    } finally {
      controller.abort(); publishAnswer();
      try { await reader?.cancel(); } catch { /* Aborting a fetch may already have closed the reader. */ }
      finally { reader?.releaseLock(); }
      setBusy(false); abort.current = null;
      setMessages(current => current.filter(message => message.id !== answerId || message.content));
      void refresh();
    }
  }
  async function decide(proposal: Proposal, approve: boolean) {
    setDecision(proposal.id); setError('');
    try {
      const response = await request(`/api/proposals/${encodeURIComponent(proposal.id)}`, { method: 'POST', body: JSON.stringify({ approve }) });
      const data = await response.json(); setStatus(data.result || (approve ? 'Memory saved' : 'Request declined'));
      setProposals(current => current.filter(item => item.id !== proposal.id)); void refresh();
    } catch (cause) { setError((cause as Error).message); }
    finally { setDecision(null); }
  }
  async function removeNote(id: string) {
    setError('');
    try { await request(`/api/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }); await loadNotes(); void refresh(); }
    catch (cause) { setError((cause as Error).message); }
  }
  function clearConversation() {
    captureGeneration.current++; capture.current?.dispose(); capture.current = null; setRecording(false);
    if (recordTimer.current) clearInterval(recordTimer.current);
    setInput(''); abort.current?.abort(); setMessages([]); setProposals([]); setMetrics(null); setStatus(''); setError('');
    stopSpeech();
  }
  function exportConversation() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), model, messages }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `auralis-conversation-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  async function stopRecording() {
    const activeCapture = capture.current; if (!activeCapture) return;
    capture.current = null; setRecording(false); setTranscribing(true);
    if (recordTimer.current) clearInterval(recordTimer.current);
    try {
      const audio = await activeCapture.finish();
      const response = await request('/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio });
      const data = await response.json(); setInput(current => `${current}${current ? ' ' : ''}${data.text}`); composer.current?.focus();
    } catch (cause) { setError((cause as Error).message); }
    finally { setTranscribing(false); }
  }
  async function toggleRecording() {
    if (recording) { await stopRecording(); return; }
    if (!health?.voice.configured) { setError('Local dictation needs a speech service. Run npm run voice:setup and follow docs/voice.md.'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setError('Microphone capture is unavailable in this browser. Open the local app in Safari or Chrome.'); return; }
    if (capturePending.current) return;
    capturePending.current = true; setStartingRecording(true); const generation = ++captureGeneration.current;
    setError('');
    try {
      stopSpeech();
      const activeCapture = await startCapture();
      if (!mounted.current || generation !== captureGeneration.current || document.hidden) { activeCapture.dispose(); return; }
      capture.current = activeCapture;
      setRecording(true); setRecordSeconds(0); let seconds = 0;
      recordTimer.current = setInterval(() => { seconds++; setRecordSeconds(seconds); if (seconds >= 30) void stopRecording(); }, 1000);
    } catch (cause) { if (mounted.current) setError(`Microphone unavailable: ${(cause as Error).message}`); }
    finally { capturePending.current = false; if (mounted.current) setStartingRecording(false); }
  }
  const connected = Boolean(health?.provider.connected);
  const modelReady = connected && Boolean(model) && Boolean(health?.provider.models.includes(model));
  const modelOptions = health?.provider.models || [];
  const modelLabel = model ? model.replace(/:latest$/, '') : 'No model connected';
  const navigate = (next: Page) => {
    if (next !== 'conversation') {
      captureGeneration.current++; capture.current?.dispose(); capture.current = null; setRecording(false);
      if (recordTimer.current) clearInterval(recordTimer.current);
    }
    setPage(next); setSidebar(false); setError('');
  };

  return <><div className="app-shell" inert={voiceOpen || undefined}>
    {sidebar && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebar(false)} />}
    <aside ref={navigation} id="workspace-navigation" className={`sidebar ${sidebar ? 'open' : ''}`} onKeyDown={event => {
      if (!sidebar || event.key !== 'Tab') return;
      const controls = navigation.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), select:not(:disabled), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }}>
      <a href="#" className="wordmark" onClick={event => { event.preventDefault(); navigate('conversation'); }} aria-label="Auralis home"><Brand /><span>auralis<span className="wordmark-dot">.</span></span></a>
      <span className="sidebar-kicker">A MIND OF YOUR OWN</span>
      <button className="new-chat" onClick={() => { clearConversation(); navigate('conversation'); }} disabled={busy}><Plus size={16} /> New conversation <span>+</span></button>
      <div className="nav-heading">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">
        {pages.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'selected' : ''}`} onClick={() => navigate(item.id)} aria-current={page === item.id ? 'page' : undefined}><item.icon size={17} strokeWidth={1.6} /><span>{item.label}</span>{item.id === 'memory' && Boolean(health?.memory.count) && <span className="nav-count">{health?.memory.count}</span>}{page === item.id && <i className="nav-dot" />}</button>)}
      </nav>
      <div className="sidebar-note"><span className="tiny-plus">✧</span><p>Good things happen<br />when you have room<br /><em>to think.</em></p><div className="note-rule" /></div>
      <div className="sidebar-bottom">
        <div className="local-badge"><ShieldCheck size={16} /><div><strong>Private by design</strong><span>Your Mac is your cloud.</span></div><span className="status-dot" /></div>
        <button className="sidebar-footer" onClick={() => navigate('settings')}><span className="avatar">A</span><span>Your personal space<small>Local workspace</small></span><Settings2 size={16} /></button>
      </div>
    </aside>
    <div className="workspace" inert={sidebar || undefined}>
      <header className="topbar">
        <div className="breadcrumb"><button ref={menuButton} className="icon-button mobile-menu" aria-label="Open navigation" aria-expanded={sidebar} aria-controls="workspace-navigation" onClick={() => setSidebar(true)}><PanelLeftOpen size={19} /></button><span>Personal workspace</span><span className="breadcrumb-slash">/</span><strong>{page === 'conversation' ? 'Conversation' : page === 'tools' ? 'Tool library' : page === 'settings' ? 'Preferences' : 'Memory'}</strong></div>
        <div className="topbar-actions"><span className={`connection ${connected ? 'connected' : ''}`}><span className="status-dot" />{connected ? 'Running locally' : health ? 'Ollama offline' : 'Connecting locally'}</span><span className="topbar-divider" /><button className="icon-button" aria-label="Refresh local connection" title="Refresh connection" onClick={() => { void refresh(); setError(''); }}><RefreshCw size={15} /></button></div>
      </header>
      <main className={`main-layout ${page !== 'conversation' ? 'full-page' : ''}`}>
        <section className={`main-content ${page === 'conversation' ? 'conversation-page' : 'content-page'}`}>
          {page === 'conversation' && <>
            <div className="conversation-toolbar"><div className="model-picker"><span className={`model-icon ${connected ? 'ready' : ''}`}><Sparkles size={14} /></span><select aria-label="Local language model" value={model} onChange={event => setModel(event.target.value)} disabled={!modelOptions.length || busy}>{!modelOptions.length && <option value="">No model connected</option>}{modelOptions.map(name => <option key={name} value={name}>{name.replace(/:latest$/, '')}</option>)}</select><ChevronDown size={12} /></div><div className="conversation-actions"><button className="voice-entry" aria-label="Open voice conversation" onClick={openVoice} disabled={busy || transcribing || startingRecording}><AudioLines size={15}/><span>Voice conversation</span></button><button className="icon-button" aria-label={speechActive ? "Stop speaking" : "Toggle spoken responses"} title={speechActive ? "Stop speaking" : "Read responses aloud"} aria-pressed={speak} onClick={()=>{if(speechActive){stopSpeech();return;}setSpeak(value=>!value);}} disabled={!localVoice}>{speak?<Volume2 size={16}/>:<VolumeX size={16}/>}</button>{messages.length > 0 && <><button className="icon-button" aria-label="Export conversation" title="Export conversation" onClick={exportConversation}><ArrowDownToLine size={15} /></button><button className="icon-button" aria-label="Clear conversation" title="Clear conversation" onClick={clearConversation} disabled={busy}><Trash2 size={15} /></button></>}<span className="session-label">LOCAL SESSION</span></div></div>
            <div className={`conversation-scroll ${messages.length ? 'has-messages' : ''}`} onScroll={event => { const panel = event.currentTarget; followTail.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 100; }}>
              {!messages.length && <div className="welcome">
                <Orb active={busy} recording={recording} />
                <div className="eyebrow"><span /> INTELLIGENCE, CLOSE TO HOME <span /></div>
                <h1>A little more space<br />for <em>your mind.</em></h1>
                <p className="welcome-description">Think out loud. Follow a spark. Make something yours.<br />Your personal AI, right here on your Mac.</p>
                <button className="welcome-talk" onClick={openVoice}><AudioLines size={19}/> Let’s talk <ArrowUpRight size={16}/></button><div className="starter-grid">{starters.map(item => <button className="starter-card" key={item.tag} onClick={() => { setInput(item.prompt); composer.current?.focus(); }}><span className="starter-top"><item.icon size={17} strokeWidth={1.5} /><ArrowUpRight size={14} /></span><span className="starter-tag">{item.tag}</span><strong>{item.title}</strong></button>)}</div>
              </div>}
              {messages.length > 0 && <div className="message-list">{messages.map(message => <article className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === 'assistant' ? <Brand small /> : 'You'}</div><div className="message-body"><div className="message-label">{message.role === 'assistant' ? 'Auralis' : 'You'}{message.role === 'assistant' && <span>ON DEVICE</span>}</div>{message.content ? <><div className="message-text">{message.content}</div>{message.role === 'assistant' && <button className="message-listen" onClick={()=>say(message.content)} disabled={!localVoice || busy}><Volume2 size={12}/> Read aloud</button>}</> : <div className="thinking-dots" aria-label="Waiting for model"><i /><i /><i /></div>}</div></article>)}
                {busy && <div className="stream-status" role="status"><span className="status-dot" />{status || 'Working locally'}<button onClick={() => abort.current?.abort()}>Stop <Square size={10} /></button></div>}
                {proposals.map(proposal => <div className="approval-card" key={proposal.id}><div className="approval-heading"><ShieldCheck size={18} /><div><strong>A little permission first</strong><span>Auralis wants to save a memory on this Mac.</span></div></div><div className="approval-preview"><strong>{proposal.args.title}</strong><p>{proposal.args.content}</p></div><div className="approval-actions"><small>{Date.now() >= proposal.expiresAt ? 'This request expired. Start a new conversation to try again.' : 'Only this exact note will be saved.'}</small><button className="button secondary" onClick={() => void decide(proposal, false)} disabled={Boolean(decision)}>Decline</button><button className="button primary" onClick={() => void decide(proposal, true)} disabled={Boolean(decision) || Date.now() >= proposal.expiresAt}>{decision === proposal.id ? <Loader2 size={14} className="spin" /> : <Check size={14} />}Save memory</button></div></div>)}
              </div>}
              <div ref={scrollEnd} />
            </div>
            <div className="composer-region">
              {health?.audit && !health.audit.available && <div className="error-notice" role="alert"><ShieldCheck size={16} /><p>The activity log could not be written. Check local storage permissions. Saved notes may still have succeeded.</p></div>}
              {!busy && status && <div className="session-feedback" role="status"><Check size={12} />{status}<button className="icon-button" aria-label="Dismiss status" onClick={() => setStatus('')}><X size={12} /></button></div>}
              {error && <div className="error-notice" role="alert"><CircleHelp size={17} /><p>{error}</p><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={14} /></button></div>}
              {recording && <div className="recording-banner" role="status"><span className="recording-dot" /><span>Listening · {recordSeconds}s / 30s</span><span>Audio stays on this Mac</span><button onClick={() => void stopRecording()}>Finish recording <Square size={10} /></button></div>}
              <form className={`composer ${recording ? 'is-recording' : ''}`} onSubmit={event => void send(event)}>
                <label className="sr-only" htmlFor="message-input">Message Auralis</label>
                <textarea ref={composer} id="message-input" placeholder={recording ? 'Listening to you…' : 'A thought, a question, a place to start…'} value={input} rows={2} maxLength={16000} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} disabled={recording || transcribing} />
                <div className="composer-controls"><div className="composer-left"><button type="button" className={`composer-tool ${toolsEnabled ? 'enabled' : ''}`} onClick={() => setToolsEnabled(current => !current)} aria-pressed={toolsEnabled} title="Allow calculator and approval-gated memory tools"><Wrench size={14} /><span>Tools</span><span className="mini-dot" /></button><span className="composer-divider" /><button type="button" className="composer-tool" onClick={() => setProfile(current => current === 'fast' ? 'balanced' : 'fast')} title="Switch generation profile"><Zap size={13} /><span>{profile === 'fast' ? 'Fast' : 'Balanced'}</span><ChevronDown size={11} /></button></div><div className="composer-right"><button type="button" className={`icon-button voice-button ${recording ? 'recording' : ''}`} onClick={() => void toggleRecording()} disabled={busy || transcribing || startingRecording} aria-label={recording ? 'Stop recording and transcribe locally' : 'Record voice locally'} title={health?.voice.configured ? 'Dictate locally · 30 seconds maximum' : 'Set up local voice in Preferences'}>{transcribing || startingRecording ? <Loader2 size={18} className="spin" /> : recording ? <Square size={16} /> : <Mic size={18} />}</button>{busy ? <button className="send-button stop" type="button" aria-label="Stop generation" onClick={() => abort.current?.abort()}><Square size={15} /></button> : <button className="send-button" type="submit" aria-label="Send message" disabled={!input.trim() || recording || transcribing || startingRecording}><ArrowUp size={19} strokeWidth={2} /></button>}</div></div>
              </form>
              <div className="composer-footnote"><span><ShieldCheck size={11} /> Just between you and your Mac.</span><span>AI can make mistakes. Stay curious.</span><span className="shortcut"><span>↵</span> to send</span></div>
            </div>
          </>}
          {page === 'memory' && <>
            <div className="page-heading"><div className="eyebrow">YOUR CONTEXT, YOUR CHOICE</div><h1>A memory<br />you <em>can see.</em></h1><p>Only notes you approve are saved. Review them here, and let go of anything that no longer fits.</p></div>
            {error && <div className="error-notice" role="alert">{error}</div>}
            <div className="section-heading"><h2>Saved on this Mac <span>{notes.length}</span></h2><button className="text-button" onClick={() => void loadNotes()}><RefreshCw size={14} /> Refresh</button></div>
            {!notes.length ? <div className="empty-state"><BookOpen size={32} strokeWidth={1} /><h3>A fresh page.</h3><p>Ask Auralis to remember something. You’ll review<br />the exact note before it becomes a memory.</p><button className="button secondary" onClick={() => { navigate('conversation'); setInput('I would like you to remember something about me. Ask me what it is.'); }}>Start a conversation <ArrowRight size={14} /></button></div> : <div className="notes-grid">{notes.map(note => <article className="note-card" key={note.id}><div><FileText size={17} /><button className="icon-button" aria-label={`Delete memory: ${note.title}`} onClick={() => void removeNote(note.id)}><Trash2 size={15} /></button></div><h3>{note.title}</h3><p>{note.content}</p><small>{new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</small></article>)}</div>}
            <div className="info-strip"><ShieldCheck size={17} /><p>Saved notes are stored locally, with no background profiling. They are not automatically sent to the model.</p></div>
          </>}
          {page === 'tools' && <>
            {health?.audit && !health.audit.available && <div className="error-notice" role="alert">The activity log could not be written. Check local storage permissions. Saved notes may still have succeeded.</div>}
            <div className="page-heading"><div className="eyebrow">A LITTLE HELP, WITH BOUNDARIES</div><h1>More capable.<br /><em>Still in your hands.</em></h1><p>Small, purpose-built tools. Clear permissions. Every action has a place in your local activity log.</p></div>
            <div className="tools-toggle-row"><div><strong>Tools in conversation</strong><p>Let your model request the tools below.</p></div><Toggle checked={toolsEnabled} onChange={() => setToolsEnabled(value => !value)} label="Enable tools in conversation" /></div>
            <div className="tool-cards"><article className="tool-card"><div className="tool-icon"><Zap size={20} /></div><span className="tag safe">READ ONLY</span><h3>Calculator</h3><p>Work through arithmetic with a bounded expression parser. No code execution.</p><div className="tool-card-footer"><span className="status-dot" /> Available when tools are enabled</div></article><article className="tool-card"><div className="tool-icon"><BookOpen size={20} /></div><span className="tag approval">YOUR APPROVAL</span><h3>Save a memory</h3><p>A note for later, saved only after you review its exact title and content.</p><div className="tool-card-footer"><ShieldCheck size={13} /> Approval required for every note</div></article></div>
            <div className="section-heading activity-heading"><h2>Local activity <span>{audit.length}</span></h2><button className="text-button" onClick={() => void loadAudit()}><RefreshCw size={14} /> Refresh</button></div>
            {error && <div className="error-notice" role="alert">{error}</div>}
            {audit.length ? <div className="audit-list">{audit.slice(0, 50).map(event => <div className="audit-event" key={event.id}><span className="audit-icon"><Activity size={14} /></span><div><strong>{event.action}</strong><p>{event.detail}</p></div><time>{new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time></div>)}</div> : <div className="small-empty"><Activity size={19} /><p>No recorded activity yet. Tool actions will appear here.</p></div>}
          </>}
          {page === 'settings' && <>
            <div className="page-heading"><div className="eyebrow">MAKE YOURSELF AT HOME</div><h1>Your assistant.<br /><em>Your way.</em></h1><p>Choose how Auralis thinks, speaks, and remembers. Everything starts with your privacy.</p></div>
            {error && <div className="error-notice" role="alert">{error}</div>}
            <section className="settings-group"><div className="settings-section-title"><Sparkles size={16} /><h2>Intelligence</h2></div><div className="setting-row"><div><strong>Local model</strong><p>{connected ? 'Models discovered from your local Ollama service.' : 'Start Ollama and install a model to connect.'}</p></div><select className="setting-select" value={model} onChange={event => setModel(event.target.value)} aria-label="Choose language model" disabled={!modelOptions.length}>{!modelOptions.length && <option>No installed models</option>}{modelOptions.map(name => <option key={name}>{name}</option>)}</select></div><div className="setting-row"><div><strong>Generation profile</strong><p>Fast uses a smaller context to keep memory use light.</p></div><div className="segmented"><button className={profile === 'fast' ? 'active' : ''} onClick={() => setProfile('fast')}>Fast</button><button className={profile === 'balanced' ? 'active' : ''} onClick={() => setProfile('balanced')}>Balanced</button></div></div></section>
            <section className="settings-group"><div className="settings-section-title"><AudioLines size={16} /><h2>Voice</h2></div><div className="setting-row"><div><strong>Speak responses</strong><p>{localVoice ? `On-device voice: ${localVoice.name}. Speaks sentence by sentence while the reply arrives.` : 'No installed local speech voice detected in this browser.'}</p></div><Toggle checked={speak} onChange={() => { setSpeak(value => !value); if (speak) window.speechSynthesis?.cancel(); }} label="Speak responses using an installed local voice" disabled={!localVoice} /></div><div className="setting-row"><div><strong>Local dictation</strong><p>{health?.voice.configured ? 'The local transcription adapter is configured. Microphone opens only when you press record.' : 'Run npm run voice:setup for local dictation. See docs/voice.md for the start commands.'}</p></div><span className={`tag ${health?.voice.configured ? 'safe' : ''}`}>{health?.voice.configured ? 'CONFIGURED' : 'SETUP NEEDED'}</span></div></section>
            <section className="settings-group"><div className="settings-section-title"><ShieldCheck size={16} /><h2>Privacy & control</h2></div><div className="setting-row"><div><strong>Conversation history</strong><p>This chat lives in memory for this browser session. Export only when you choose.</p></div><span className="tag safe">SESSION ONLY</span></div><div className="setting-row"><div><strong>Model tools</strong><p>Calculator is bounded. Saving a note needs your approval.</p></div><Toggle checked={toolsEnabled} onChange={() => setToolsEnabled(value => !value)} label="Allow model tools" /></div><div className="setting-row"><div><strong>Current conversation</strong><p>Export a copy, or clear the messages from this session.</p></div><div className="setting-buttons"><button className="button secondary" onClick={exportConversation} disabled={!messages.length}><ArrowDownToLine size={14} /> Export</button><button className="button secondary danger" onClick={clearConversation} disabled={busy || !messages.length}><Trash2 size={14} /> Clear</button></div></div></section>
            <div className="about-card"><Brand /><div><strong>Auralis <span>0.1</span></strong><p>An independent, local-first assistant.<br />Built for a little more clarity, and a lot more ownership.</p></div><span className="about-local"><ShieldCheck size={14} /> LOCAL FIRST</span></div>
          </>}
        </section>
        {page === 'conversation' && <aside className="inspector" aria-label="Session information">
          <div className="inspector-heading"><span>BEHIND THE MOMENT</span><Activity size={14} /></div>
          <div className="inspector-status"><span className={`status-orbit ${connected ? 'ready' : ''}`}><i /></span><div><strong>{recording ? 'Listening, locally' : busy ? 'Thinking with you' : modelReady ? 'Here when you need me' : 'Waiting for your model'}</strong><span>{recording ? 'Microphone is active' : busy ? status : modelReady ? 'Your local model is ready' : connected ? 'Install a model in Ollama to begin' : 'Connect Ollama to begin'}</span></div></div>
          <div className="inspector-divider" />
          <div className="inspector-section"><span className="section-kicker">THE SETUP</span><dl><div><dt>Inference</dt><dd>Ollama <span className={`micro-dot ${connected ? 'green' : ''}`} /></dd></div><div><dt>Model</dt><dd className="model-value" title={modelLabel}>{modelLabel}</dd></div><div><dt>Profile</dt><dd>{profile === 'fast' ? 'Fast & light' : 'Balanced'}</dd></div><div><dt>Tools</dt><dd>{toolsEnabled ? 'Available' : 'Off'}</dd></div></dl></div>
          <div className="inspector-divider" />
          <div className="inspector-section"><span className="section-kicker">THIS CONVERSATION</span><dl><div><dt>Messages</dt><dd>{messages.filter(message => message.content).length.toString().padStart(2, '0')}</dd></div><div><dt>First response</dt><dd>{metrics?.ttftMs != null ? `${(metrics.ttftMs / 1000).toFixed(2)} s` : '—'}</dd></div><div><dt>Generation</dt><dd>{metrics?.tokensPerSecond ? `${metrics.tokensPerSecond.toFixed(1)} tok/s` : '—'}</dd></div></dl>{!metrics && <p className="metrics-note">Measured here, after your first response.</p>}</div>
          <div className="inspector-divider" />
          <div className="inspector-section"><span className="section-kicker">A CLEAR BOUNDARY</span><ul className="privacy-checks"><li><Check size={12} /> No cloud fallback</li><li><Check size={12} /> No background listening</li><li><Check size={12} /> You approve saved memory</li></ul></div>
          <div className="privacy-card"><ShieldCheck size={22} strokeWidth={1.3} /><strong>Closer to you.<br />Further from the cloud.</strong><p>Conversations stay in this session. Your model runs on your Mac.</p><button onClick={() => navigate('settings')}>Your privacy controls <ArrowUpRight size={13} /></button></div>
          <div className="inspector-footer"><span className="footer-star">✳</span> A little intelligence. A lot of possibility.</div>
        </aside>}
      </main>
      <footer className="workspace-footer"><span>PERSONAL INTELLIGENCE, LOCALLY.</span><span><span className="status-dot" />{apiReady ? 'Local service connected' : 'Connecting to local service'}</span></footer>
    </div>
  </div>{voiceOpen && <VoiceRoom request={request} models={modelOptions} model={model} configured={Boolean(health?.voice.configured)} history={messages} onClose={()=>setVoiceOpen(false)} onTurn={(user,answer)=>setMessages(current=>[...current,{id:uid(),role:'user',content:user},...(answer?[{id:uid(),role:'assistant' as const,content:answer}]:[])])}/> }</>;
}
