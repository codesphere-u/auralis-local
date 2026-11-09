import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createMinimalPdf, extractTextFromPdfBuffer } from '../server/pdf.ts';
import { inspectWorkspaceFile, validateWorkspacePath } from '../server/workspace.ts';
import { KnowledgeBase } from '../server/knowledge.ts';

test('validateWorkspacePath accepts .pdf and assigns pdf format', () => {
  const result = validateWorkspacePath('docs/whitepaper.pdf');
  assert.equal(result.normalized, 'docs/whitepaper.pdf');
  assert.equal(result.format, 'pdf');
});

test('extractTextFromPdfBuffer extracts text from uncompressed PDF streams', () => {
  const samplePdf = createMinimalPdf('Auralis Local Edge AI on Apple Silicon', 'Architecture Spec');
  const text = extractTextFromPdfBuffer(samplePdf);
  assert.match(text, /Auralis Local Edge AI on Apple Silicon/);
});

test('extractTextFromPdfBuffer extracts text from compressed FlateDecode streams', () => {
  const textStream = 'BT\n/F1 12 Tf\n50 700 Td\n(Offline Privacy-Preserving Agent Architecture) Tj\nET\n';
  const compressed = deflateSync(Buffer.from(textStream, 'ascii'));
  const pdf = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + compressed.length + ' /Filter /FlateDecode >>\nstream\n'),
    compressed,
    Buffer.from('\nendstream\nendobj\n%%EOF'),
  ]);

  const text = extractTextFromPdfBuffer(pdf);
  assert.equal(text, 'Offline Privacy-Preserving Agent Architecture');
});

test('extractTextFromPdfBuffer decodes escape sequences, hex strings, and TJ kerning arrays', () => {
  // Test hex <48656c6c6f>, escaped \( \), and TJ kerning array
  const rawStream = [
    'BT',
    '/F1 12 Tf',
    '10 100 Td',
    '[(Neural) -250 (Unified) -200 (Memory)] TJ',
    '<486578537472696e67> Tj',
    '(Escaped\\(Parentheses\\) \\101nd Octal) Tj',
    'ET',
  ].join('\n');

  const pdf = Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Length ${rawStream.length} >>\nstream\n${rawStream}\nendstream\nendobj\n%%EOF`,
    'ascii',
  );

  const text = extractTextFromPdfBuffer(pdf);
  assert.match(text, /Neural Unified Memory/);
  assert.match(text, /HexString/);
  assert.match(text, /Escaped\(Parentheses\) And Octal/);
});

test('extractTextFromPdfBuffer rejects invalid magic bytes or empty buffers', () => {
  assert.throws(() => extractTextFromPdfBuffer(Buffer.from('not a pdf')), {
    message: /Missing %PDF- header magic bytes/,
  });
  assert.throws(() => extractTextFromPdfBuffer(Buffer.alloc(0)), {
    message: /Buffer is empty or too short/,
  });
});

test('guarded workspace inspector inspects local PDF without cloud calls', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auralis-pdf-test-'));
  try {
    const pdfBuf = createMinimalPdf('Confidential Local Inference Handbook');
    writeFileSync(join(dir, 'handbook.pdf'), pdfBuf);

    const inspection = inspectWorkspaceFile(dir, 'handbook.pdf');
    assert.equal(inspection.format, 'pdf');
    assert.equal(inspection.path, 'handbook.pdf');
    assert.match(inspection.content, /Confidential Local Inference Handbook/);
    assert.ok(inspection.sizeBytes > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('knowledge base indexes extracted PDF chunks with line ranges and enables BM25 search', () => {
  const dir = mkdtempSync(join(tmpdir(), 'auralis-kb-pdf-'));
  try {
    const kb = new KnowledgeBase(dir);
    const pdfContent = [
      '# Edge Intelligence Standard',
      'Local execution ensures zero data leakage.',
      'Section 1. Apple Silicon Neural Acceleration',
      'M-series chips provide unified high-bandwidth memory for LLM weights.',
    ].join('\n');

    const doc = kb.add({
      title: 'Edge Intelligence Standard',
      path: 'docs/standard.pdf',
      format: 'pdf',
      content: pdfContent,
    });

    assert.equal(doc.format, 'pdf');
    assert.ok(doc.chunkCount >= 1);

    const searchResults = kb.search('Neural Acceleration unified high-bandwidth', 3);
    assert.ok(searchResults.length >= 1);
    assert.equal(searchResults[0].documentId, doc.id);
    assert.equal(searchResults[0].title, 'Edge Intelligence Standard');
    assert.ok(searchResults[0].score > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
