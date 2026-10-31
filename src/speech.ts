/** Incremental sentence boundaries keep speech ahead of the completed reply. */
export class SentenceBuffer {
  private text = '';
  push(fragment: string, final = false): string[] {
    this.text += fragment;
    const parts: string[] = [];
    while (this.text.length) {
      const sentence = this.text.match(final ? /^([\s\S]*?[.!?](?:["')\]]?))(?=\s|$)/ : /^([\s\S]*?[.!?](?:["')\]]?))(?=\s)/);
      let length = sentence?.[0].length || 0;
      if (!length && this.text.length > 180) length = this.text.lastIndexOf(' ', 160) + 1;
      if (!length && final) length = this.text.length;
      if (!length) break;
      const part = this.text.slice(0, length).trim(); this.text = this.text.slice(length);
      if (part) parts.push(part);
    }
    return parts;
  }
}
export function spokenText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' Code is shown in the conversation. ')
    .replace(/https?:\/\/\S+/g, 'the linked address').replace(/[*#_`~]/g, '').trim();
}
export class SentenceSpeaker {
  private buffer = new SentenceBuffer();
  private queue: string[] = [];
  private active = false;
  private closed = false;
  private finished = false;
  private generation = 0;
  private waiters: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private voice: SpeechSynthesisVoice, private rate: number, private onSpeaking: (active: boolean) => void, private onError = () => {}) {}
  push(text: string) { if (!this.closed) { this.queue.push(...this.buffer.push(text)); this.pump(); } }
  finish(): Promise<void> {
    if(this.closed) return Promise.resolve();
    this.queue.push(...this.buffer.push('', true)); this.finished = true;
    const done = new Promise<void>(resolve => this.waiters.push(resolve)); this.pump(); return done;
  }
  cancel() {
    this.closed = true; this.generation++; this.queue = []; this.active = false;
    clearTimeout(this.timer);
    window.speechSynthesis.cancel(); this.onSpeaking(false); this.resolve();
  }
  private resolve() { this.waiters.splice(0).forEach(resolve => resolve()); }
  private pump() {
    if(this.closed || this.active) return;
    const text = this.queue.shift();
    if(!text) { this.onSpeaking(false); if(this.finished) this.resolve(); return; }
    const clean = spokenText(text);
    if(!clean) { this.pump(); return; }
    const utterance = new SpeechSynthesisUtterance(clean); utterance.voice = this.voice; utterance.rate = this.rate;
    const generation = this.generation; this.active = true;
    utterance.onstart = () => { if(generation === this.generation) this.onSpeaking(true); };
    utterance.onend = () => { if(generation !== this.generation) return; clearTimeout(this.timer); this.active = false; this.pump(); };
    const failed = () => { if(generation !== this.generation) return; this.cancel(); this.onError(); };
    utterance.onerror = failed;
    this.timer = setTimeout(failed, 30000);
    window.speechSynthesis.speak(utterance);
  }
}
