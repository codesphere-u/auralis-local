import { randomUUID } from 'node:crypto';
import { noteArgs, type Store } from './store.ts';
export class Proposals {
  private pending = new Map<string, {owner:string;tool:'note.save';args:{title:string;content:string};expiresAt:number}>();
  constructor(private store: Store, private now = Date.now) {}
  create(owner: string, args: unknown) {
    for (const [id,p] of this.pending) if (p.expiresAt <= this.now()) this.pending.delete(id);
    if (this.pending.size >= 100) throw new Error('Too many pending approvals');
    const proposal = {owner,tool:'note.save' as const,args:noteArgs.parse(args),expiresAt:this.now()+300_000};
    const id = randomUUID(); this.pending.set(id, proposal); this.store.audit('tool.proposed','note.save');
    return {id,tool:proposal.tool,args:proposal.args,expiresAt:proposal.expiresAt};
  }
  decide(owner: string, id: string, approve: boolean) {
    const p = this.pending.get(id);
    if (!p || p.owner !== owner) throw new Error('Approval not found');
    this.pending.delete(id); // Consume before performing a side effect: retries cannot replay.
    if (p.expiresAt <= this.now()) throw new Error('Approval expired');
    if (!approve) { this.store.audit('tool.denied',p.tool); return 'Note was not saved.'; }
    this.store.save(p.args); return 'Note saved to local memory.';
  }
}
