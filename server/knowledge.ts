import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './store.ts';

export const SUPPORTED_FORMATS = ['md', 'txt', 'json', 'ts', 'py', 'js'] as const;
export type KnowledgeFormat = (typeof SUPPORTED_FORMATS)[number];

export const knowledgeDocArgs = z.object({
  title: z.string().trim().min(1).max(160),
  path: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .regex(/^[a-zA-Z0-9._/-]+$/, 'Path may only contain alphanumeric characters, dots, underscores, hyphens, and slashes')
    .refine(
      p => !p.startsWith('/') && !p.split('/').some(part => part === '..' || part === '.' || part.startsWith('.')),
      'Relative path without dotfile segments or traversal required',
    )
    .optional(),
  format: z.enum(SUPPORTED_FORMATS).default('md'),
  content: z.string().trim().min(1).max(64000),
}).strict();

export type KnowledgeDocumentInput = z.infer<typeof knowledgeDocArgs>;

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  title: string;
  path: string;
  heading?: string;
  startLine: number;
  endLine: number;
  text: string;
  tokens: string[];
};

export type KnowledgeDocument = {
  id: string;
  title: string;
  path: string;
  format: KnowledgeFormat;
  content: string;
  createdAt: string;
  chunkCount: number;
  tokenCount: number;
  lineCount: number;
};

export type Citation = {
  chunkId: string;
  documentId: string;
  title: string;
  path: string;
  heading?: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  matchedTerms: string[];
};

export type KnowledgeStats = {
  documentCount: number;
  chunkCount: number;
  totalTokens: number;
  avgChunkTokens: number;
};

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this',
  'to', 'was', 'were', 'will', 'with', 'what', 'when', 'where', 'which', 'who',
  'how', 'why', 'can', 'does', 'do', 'into', 'about', 'your', 'you',
]);

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  return matches.filter(token => token.length > 1 && !STOP_WORDS.has(token));
}

function slugPath(title: string, format: KnowledgeFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'document';
  return `notes/${slug}.${format}`;
}

function detectHeading(line: string, format: KnowledgeFormat): string | undefined {
  const trimmed = line.trim();
  if (format === 'md') {
    const match = trimmed.match(/^#{1,4}\s+(.+)$/);
    if (match) return match[1].trim().slice(0, 120);
  } else if (format === 'ts' || format === 'js') {
    const match = trimmed.match(/^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+([a-zA-Z0-9_]+)/);
    if (match) return match[1];
  } else if (format === 'py') {
    const match = trimmed.match(/^(?:async\s+)?(?:def|class)\s+([a-zA-Z0-9_]+)/);
    if (match) return match[1];
  }
  return undefined;
}

export function chunkDocument(
  doc: { id: string; title: string; path: string; format: KnowledgeFormat; content: string },
  maxChars = 720,
): KnowledgeChunk[] {
  const rawLines = doc.content.replace(/\r\n/g, '\n').split('\n');
  const chunks: KnowledgeChunk[] = [];
  let currentLines: string[] = [];
  let currentStart = 1;
  let currentChars = 0;
  let currentHeading: string | undefined;
  let chunkHeading: string | undefined;

  const flush = (endLine: number) => {
    const text = currentLines.join('\n').trim();
    if (!text) return;
    const headingContext = chunkHeading || currentHeading;
    const tokens = tokenize(`${doc.title} ${headingContext || ''} ${text}`);
    chunks.push({
      id: `${doc.id}#L${currentStart}-L${endLine}`,
      documentId: doc.id,
      title: doc.title,
      path: doc.path,
      ...(headingContext ? { heading: headingContext } : {}),
      startLine: currentStart,
      endLine,
      text,
      tokens,
    });
  };

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNo = idx + 1;
    const line = rawLines[idx];
    const detected = detectHeading(line, doc.format);

    if (detected) {
      if (currentLines.length > 0 && currentChars >= 120) {
        flush(lineNo - 1);
        currentLines = [];
        currentChars = 0;
        currentStart = lineNo;
      }
      currentHeading = detected;
      if (currentLines.length === 0) chunkHeading = detected;
    }

    if (currentLines.length === 0) {
      currentStart = lineNo;
      chunkHeading = currentHeading;
    }

    currentLines.push(line);
    currentChars += line.length + 1;

    const isBlankBoundary = line.trim() === '' && currentChars >= Math.floor(maxChars * 0.55);
    if (currentChars >= maxChars || isBlankBoundary) {
      flush(lineNo);
      const overlap = currentLines.length > 2 && line.trim() !== '' ? [currentLines[currentLines.length - 1]] : [];
      currentLines = overlap;
      currentChars = overlap.reduce((sum, l) => sum + l.length + 1, 0);
      currentStart = overlap.length ? lineNo : lineNo + 1;
      chunkHeading = currentHeading;
    }
  }

  if (currentLines.length > 0) {
    flush(rawLines.length);
  }

  return chunks;
}

export function rankChunksBM25(
  chunks: KnowledgeChunk[],
  query: string,
  limit = 5,
): Citation[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || chunks.length === 0) return [];
  const uniqueQueryTokens = [...new Set(queryTokens)];
  const normalizedPhrase = uniqueQueryTokens.length >= 2 ? uniqueQueryTokens.join(' ') : '';

  const N = chunks.length;
  const avgdl = chunks.reduce((sum, c) => sum + c.tokens.length, 0) / N || 1;
  const k1 = 1.5;
  const b = 0.75;

  const docFreq = new Map<string, number>();
  for (const term of uniqueQueryTokens) {
    let df = 0;
    for (const chunk of chunks) {
      if (chunk.tokens.includes(term)) df++;
    }
    docFreq.set(term, df);
  }

  const scored: Citation[] = [];

  for (const chunk of chunks) {
    const termFreq = new Map<string, number>();
    for (const t of chunk.tokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + 1);
    }

    let bm25 = 0;
    const matchedTerms: string[] = [];

    for (const term of uniqueQueryTokens) {
      const tf = termFreq.get(term) || 0;
      if (tf === 0) continue;
      matchedTerms.push(term);
      const df = docFreq.get(term) || 0;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      const normTf = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (chunk.tokens.length / avgdl)));
      bm25 += idf * normTf;
    }

    if (matchedTerms.length === 0) continue;

    // Hybrid signals: token overlap coverage, title/heading match, and exact phrase boost
    const coverageBoost = (matchedTerms.length / uniqueQueryTokens.length) * 1.15;
    const headerTokens = new Set(tokenize(`${chunk.title} ${chunk.heading || ''}`));
    let headerMatches = 0;
    for (const term of matchedTerms) {
      if (headerTokens.has(term)) headerMatches++;
    }
    const headerBoost = headerMatches * 0.85;

    const normalizedChunkText = tokenize(chunk.text).join(' ');
    const exactPhraseBoost =
      normalizedPhrase && (normalizedChunkText.includes(normalizedPhrase) || chunk.text.toLowerCase().includes(query.trim().toLowerCase()))
        ? 2.25
        : 0;

    const score = Math.round((bm25 + coverageBoost + headerBoost + exactPhraseBoost) * 1000) / 1000;

    scored.push({
      chunkId: chunk.id,
      documentId: chunk.documentId,
      title: chunk.title,
      path: chunk.path,
      ...(chunk.heading ? { heading: chunk.heading } : {}),
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      snippet: chunk.text.length > 420 ? chunk.text.slice(0, 417) + '…' : chunk.text,
      score,
      matchedTerms,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.startLine - b.startLine)
    .slice(0, Math.max(1, Math.min(limit, 20)));
}

const storedDocSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  path: z.string().min(1).max(240),
  format: z.enum(SUPPORTED_FORMATS),
  content: z.string().min(1).max(64000),
  createdAt: z.string(),
});

type StoredDoc = z.infer<typeof storedDocSchema>;

export class KnowledgeBase {
  private filePath: string;
  private docs: StoredDoc[] = [];
  private chunks: KnowledgeChunk[] = [];

  constructor(
    public directory: string,
    private store?: Store,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.filePath = join(directory, 'knowledge.json');
    if (!existsSync(this.filePath)) {
      this.persist([]);
    } else {
      this.reload();
    }
  }

  private reload() {
    const raw = JSON.parse(readFileSync(this.filePath, 'utf8'));
    this.docs = z.array(storedDocSchema).parse(raw);
    this.rebuildIndex();
  }

  private rebuildIndex() {
    this.chunks = this.docs.flatMap(doc => chunkDocument(doc));
  }

  private persist(docs: StoredDoc[]) {
    const temp = this.filePath + '.tmp';
    writeFileSync(temp, JSON.stringify(docs, null, 2), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.filePath);
    this.docs = docs;
    this.rebuildIndex();
  }

  list(): Omit<KnowledgeDocument, 'content'>[] {
    return this.docs.map(doc => {
      const docChunks = this.chunks.filter(c => c.documentId === doc.id);
      const tokenCount = docChunks.reduce((sum, c) => sum + c.tokens.length, 0);
      const lineCount = doc.content.replace(/\r\n/g, '\n').split('\n').length;
      return {
        id: doc.id,
        title: doc.title,
        path: doc.path,
        format: doc.format,
        createdAt: doc.createdAt,
        chunkCount: docChunks.length,
        tokenCount,
        lineCount,
      };
    });
  }

  stats(): KnowledgeStats {
    const documentCount = this.docs.length;
    const chunkCount = this.chunks.length;
    const totalTokens = this.chunks.reduce((sum, c) => sum + c.tokens.length, 0);
    return {
      documentCount,
      chunkCount,
      totalTokens,
      avgChunkTokens: chunkCount ? Math.round(totalTokens / chunkCount) : 0,
    };
  }

  add(input: unknown): Omit<KnowledgeDocument, 'content'> {
    const parsed = knowledgeDocArgs.parse(input);
    if (this.docs.length >= 200) {
      throw new Error('Knowledge base limit reached (200 documents). Remove a document first.');
    }
    const format = parsed.format || 'md';
    const path = parsed.path || slugPath(parsed.title, format);
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const newDoc: StoredDoc = {
      id,
      title: parsed.title,
      path,
      format,
      content: parsed.content,
      createdAt,
    };
    this.persist([...this.docs, newDoc]);
    this.store?.audit('knowledge.indexed', id);
    const docChunks = this.chunks.filter(c => c.documentId === id);
    return {
      id,
      title: newDoc.title,
      path: newDoc.path,
      format: newDoc.format,
      createdAt,
      chunkCount: docChunks.length,
      tokenCount: docChunks.reduce((sum, c) => sum + c.tokens.length, 0),
      lineCount: newDoc.content.replace(/\r\n/g, '\n').split('\n').length,
    };
  }

  remove(id: string): boolean {
    const next = this.docs.filter(d => d.id !== id);
    if (next.length === this.docs.length) return false;
    this.persist(next);
    this.store?.audit('knowledge.deleted', id);
    return true;
  }

  search(query: string, limit = 5): Citation[] {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 1000) return [];
    const results = rankChunksBM25(this.chunks, trimmed, limit);
    this.store?.audit('knowledge.searched', `hits:${results.length}`);
    return results;
  }
}
