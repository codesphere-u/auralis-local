import { randomUUID } from 'node:crypto';
import { noteArgs, type Store } from './store.ts';
import { knowledgeDocArgs, type KnowledgeBase, type KnowledgeDocumentInput } from './knowledge.ts';

type PendingProposal =
  | { owner: string; tool: 'note.save'; args: { title: string; content: string }; expiresAt: number }
  | { owner: string; tool: 'knowledge.index'; args: KnowledgeDocumentInput; expiresAt: number };

export class Proposals {
  private pending = new Map<string, PendingProposal>();
  constructor(
    private store: Store,
    private now = Date.now,
    private knowledge?: KnowledgeBase,
  ) {}

  private prune() {
    for (const [id, p] of this.pending) {
      if (p.expiresAt <= this.now()) this.pending.delete(id);
    }
    if (this.pending.size >= 100) throw new Error('Too many pending approvals');
  }

  create(owner: string, args: unknown, tool: 'note.save' | 'knowledge.index' = 'note.save') {
    this.prune();
    if (tool === 'knowledge.index') {
      const parsed = knowledgeDocArgs.parse(args);
      const proposal: PendingProposal = { owner, tool: 'knowledge.index', args: parsed, expiresAt: this.now() + 300_000 };
      const id = randomUUID();
      this.pending.set(id, proposal);
      this.store.audit('tool.proposed', 'knowledge.index');
      return { id, tool: proposal.tool, args: proposal.args, expiresAt: proposal.expiresAt };
    }
    const proposal: PendingProposal = { owner, tool: 'note.save', args: noteArgs.parse(args), expiresAt: this.now() + 300_000 };
    const id = randomUUID();
    this.pending.set(id, proposal);
    this.store.audit('tool.proposed', 'note.save');
    return { id, tool: proposal.tool, args: proposal.args, expiresAt: proposal.expiresAt };
  }

  decide(owner: string, id: string, approve: boolean) {
    const p = this.pending.get(id);
    if (!p || p.owner !== owner) throw new Error('Approval not found');
    this.pending.delete(id); // Consume before performing a side effect: retries cannot replay.
    if (p.expiresAt <= this.now()) throw new Error('Approval expired');
    if (!approve) {
      this.store.audit('tool.denied', p.tool);
      return p.tool === 'knowledge.index' ? 'Document was not indexed.' : 'Note was not saved.';
    }
    if (p.tool === 'knowledge.index') {
      if (!this.knowledge) throw new Error('Knowledge base unavailable');
      this.knowledge.add(p.args);
      return 'Document indexed into local knowledge base.';
    }
    this.store.save(p.args);
    return 'Note saved to local memory.';
  }
}
