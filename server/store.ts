import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export const noteArgs = z.object({title: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(8000)}).strict();
export type Note = z.infer<typeof noteArgs> & {id:string;createdAt:string};
type Event = {id:string;at:string;action:string;detail:string};
export class Store {
  auditHealthy = true;
  private notesPath: string;
  private auditPath: string;
  constructor(public directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
    this.notesPath = join(directory, 'notes.json'); this.auditPath = join(directory, 'audit.jsonl');
    if (!existsSync(this.notesPath)) this.writeNotes([]);
  }
  notes(): Note[] { return z.array(noteArgs.extend({id:z.string().uuid(),createdAt:z.string()})).parse(JSON.parse(readFileSync(this.notesPath, 'utf8'))); }
  private writeNotes(notes: Note[]) {
    const temp = this.notesPath + '.tmp';
    writeFileSync(temp, JSON.stringify(notes, null, 2), { mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, this.notesPath);
  }
  save(args: unknown): Note {
    const parsed = noteArgs.parse(args); const notes = this.notes();
    if (notes.length >= 500) throw new Error('Memory limit reached. Delete a note first.');
    const note = {...parsed,id:randomUUID(),createdAt:new Date().toISOString()};
    this.writeNotes([...notes,note]); this.audit('note.saved', note.id); return note;
  }
  delete(id: string): boolean {
    const old = this.notes(); const next = old.filter(x=>x.id !== id);
    if (old.length === next.length) return false;
    this.writeNotes(next); this.audit('note.deleted',id); return true;
  }
  audit(action: string, detail: string) {
    try {
    // Never pass user prompts, note text, model output or audio here.
    if (existsSync(this.auditPath) && statSync(this.auditPath).size > 1_000_000) writeFileSync(this.auditPath, '', {mode:0o600});
    const event: Event = {id:randomUUID(),at:new Date().toISOString(),action,detail};
    appendFileSync(this.auditPath, JSON.stringify(event)+'\n', {mode:0o600}); chmodSync(this.auditPath, 0o600);
    this.auditHealthy=true;
    } catch {this.auditHealthy=false;}
  }
  events(): Event[] {
    if (!existsSync(this.auditPath)) return [];
    return readFileSync(this.auditPath,'utf8').trim().split('\n').filter(Boolean).slice(-200).map(x=>JSON.parse(x));
  }
}
