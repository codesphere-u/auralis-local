/**
 * Zero-dependency, local-first PDF text extractor for Auralis-Local.
 * Parses PDF streams, decompresses /FlateDecode streams using node:zlib,
 * and extracts text strings from PDF text operators (Tj, TJ, ', ") within BT/ET blocks.
 */

import { inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Decodes standard PDF literal string escape sequences and octal character codes.
 */
function decodePdfLiteralString(str: string): string {
  return str.replace(/\\([0-7]{1,3}|[\\()nrtbf])/g, (_, esc: string) => {
    if (/^[0-7]+$/.test(esc)) {
      return String.fromCharCode(parseInt(esc, 8));
    }
    switch (esc) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '(':
        return '(';
      case ')':
        return ')';
      case '\\':
        return '\\';
      default:
        return esc;
    }
  });
}

/**
 * Decodes hex string format <48656c6c6f> -> "Hello".
 */
function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let result = '';
  for (let i = 0; i < clean.length; i += 2) {
    const byte = clean.slice(i, i + 2);
    if (byte.length === 1) {
      result += String.fromCharCode(parseInt(byte + '0', 16));
    } else {
      result += String.fromCharCode(parseInt(byte, 16));
    }
  }
  return result;
}

/**
 * Extracts text from decompressed PDF content stream operators.
 */
function extractTextFromOperators(content: string): string {
  const textLines: string[] = [];

  // Match all text objects between BT (Begin Text) and ET (End Text)
  const btRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let btMatch: RegExpExecArray | null;

  while ((btMatch = btRegex.exec(content)) !== null) {
    const block = btMatch[1];
    const linesInBlock: string[] = [];
    let currentLine = '';

    // Regex matching operators: Tj, TJ, ', ", Td, TD, T*
    // Matches string literals (text), hex strings <text>, or TJ arrays [...]
    const opRegex = /(?:(\((?:[^()\\]|\\.)*\))|<([0-9a-fA-F\s]+)>|\[((?:[^\[\]]|\((?:[^()\\]|\\.)*\))*)\])\s*(Tj|TJ|'|")|(T\*|T[dD])/g;
    let opMatch: RegExpExecArray | null;

    while ((opMatch = opRegex.exec(block)) !== null) {
      const literalStr = opMatch[1];
      const hexStr = opMatch[2];
      const tjArray = opMatch[3];
      const op = opMatch[4];
      const moveOp = opMatch[5];

      if (moveOp) {
        if (currentLine.trim()) {
          linesInBlock.push(currentLine.trim());
          currentLine = '';
        }
        continue;
      }

      if (literalStr) {
        // Strip outer parens
        const rawContent = literalStr.slice(1, -1);
        const decoded = decodePdfLiteralString(rawContent);
        if (op === "'" || op === '"') {
          if (currentLine.trim()) linesInBlock.push(currentLine.trim());
          currentLine = decoded;
        } else {
          currentLine += decoded;
        }
      } else if (hexStr) {
        const decoded = decodePdfHexString(hexStr);
        if (op === "'" || op === '"') {
          if (currentLine.trim()) linesInBlock.push(currentLine.trim());
          currentLine = decoded;
        } else {
          currentLine += decoded;
        }
      } else if (tjArray) {
        // Parse array of elements: (string) or <hex> or numbers (kerning)
        const itemRegex = /(?:\(((?:[^()\\]|\\.)*)\)|<([0-9a-fA-F\s]+)>|(-?\d+(?:\.\d+)?))/g;
        let itemMatch: RegExpExecArray | null;
        let arrayText = '';
        while ((itemMatch = itemRegex.exec(tjArray)) !== null) {
          if (itemMatch[1] !== undefined) {
            arrayText += decodePdfLiteralString(itemMatch[1]);
          } else if (itemMatch[2] !== undefined) {
            arrayText += decodePdfHexString(itemMatch[2]);
          } else if (itemMatch[3] !== undefined) {
            const kern = parseFloat(itemMatch[3]);
            // If significant negative kerning space (e.g. -200 or more in standard font units)
            if (kern < -150) {
              arrayText += ' ';
            }
          }
        }
        if (op === "'" || op === '"') {
          if (currentLine.trim()) linesInBlock.push(currentLine.trim());
          currentLine = arrayText;
        } else {
          currentLine += arrayText;
        }
      }
    }

    if (currentLine.trim()) {
      linesInBlock.push(currentLine.trim());
    }

    if (linesInBlock.length > 0) {
      textLines.push(linesInBlock.join('\n'));
    }
  }

  // Fallback: If no BT/ET blocks were matched, attempt direct literal string extraction
  if (textLines.length === 0) {
    const rawMatches = content.match(/\(([^()\\]{2,})\)\s*(?:Tj|'|")/g);
    if (rawMatches) {
      const fallbackStrings = rawMatches.map(m => {
        const inner = m.replace(/^\(/, '').replace(/\)\s*(?:Tj|'|")$/, '');
        return decodePdfLiteralString(inner).trim();
      }).filter(s => s.length > 0);
      if (fallbackStrings.length > 0) {
        textLines.push(fallbackStrings.join(' '));
      }
    }
  }

  return textLines.join('\n\n');
}

/**
 * Extract plain text from a PDF Buffer without external dependencies or cloud calls.
 * Preserves page/paragraph separation and UTF-8 / Latin-1 content.
 */
export function extractTextFromPdfBuffer(buffer: Buffer): string {
  if (!buffer || buffer.length < 5) {
    throw new Error('Invalid PDF: Buffer is empty or too short.');
  }

  // Verify PDF magic header
  const magic = buffer.subarray(0, 5).toString('ascii');
  if (magic !== '%PDF-') {
    throw new Error('Invalid PDF: Missing %PDF- header magic bytes.');
  }

  const raw = buffer.toString('binary');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match: RegExpExecArray | null;
  const extractedSections: string[] = [];

  while ((match = streamRegex.exec(raw)) !== null) {
    const streamStart = match.index + match[0].indexOf('\n') + 1;
    const streamEnd = match.index + match[0].lastIndexOf('endstream');
    const streamBytes = buffer.subarray(streamStart, streamEnd);

    // Inspect preceding dictionary to identify compression filters
    const dictSlice = raw.slice(Math.max(0, match.index - 600), match.index);
    let decompressed: string | null = null;

    if (dictSlice.includes('/FlateDecode') || dictSlice.includes('/Fl')) {
      try {
        decompressed = inflateSync(streamBytes).toString('latin1');
      } catch {
        try {
          decompressed = inflateRawSync(streamBytes).toString('latin1');
        } catch {
          decompressed = null;
        }
      }
    } else {
      decompressed = streamBytes.toString('latin1');
    }

    if (decompressed) {
      const sectionText = extractTextFromOperators(decompressed);
      if (sectionText.trim()) {
        extractedSections.push(sectionText.trim());
      }
    }
  }

  // If no stream yielded text, test raw binary text operators
  if (extractedSections.length === 0) {
    const rawText = extractTextFromOperators(raw);
    if (rawText.trim()) {
      extractedSections.push(rawText.trim());
    }
  }

  const result = extractedSections.join('\n\n').trim();
  if (!result) {
    throw new Error('PDF contains no extractable text content (may be scanned raster image or encrypted).');
  }

  return result;
}

/**
 * Creates a minimal valid compliant PDF buffer with text for local testing and benchmarking.
 */
export function createMinimalPdf(text: string, title = 'Auralis Document'): Buffer {
  const escapedText = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const streamContent = `BT\n/F1 12 Tf\n100 700 Td\n(${escapedText}) Tj\nET\n`;
  const streamLength = Buffer.byteLength(streamContent, 'ascii');

  const pdfBody = [
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${streamLength} >>`,
    'stream',
    streamContent,
    'endstream',
    'endobj',
    '5 0 obj',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    'endobj',
    'xref',
    '0 6',
    '0000000000 65535 f ',
    '0000000009 00000 n ',
    '0000000058 00000 n ',
    '0000000115 00000 n ',
    '0000000244 00000 n ',
    '0000000350 00000 n ',
    'trailer',
    '<< /Size 6 /Root 1 0 R >>',
    'startxref',
    '430',
    '%%EOF',
  ].join('\n');

  return Buffer.from(pdfBody, 'utf8');
}
