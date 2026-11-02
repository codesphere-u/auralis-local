import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { KnowledgeFormat } from './knowledge.ts';

const ALLOWED_EXTENSIONS = new Map<string, KnowledgeFormat>([
  ['.md', 'md'],
  ['.txt', 'txt'],
  ['.json', 'json'],
  ['.ts', 'ts'],
  ['.tsx', 'ts'],
  ['.py', 'py'],
  ['.js', 'js'],
]);

const BLOCKED_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.ssh',
  '.aws',
  '.gnupg',
]);

const SENSITIVE_NAME_PATTERN =
  /(?:^|[._-])(?:env|secret|secrets|credential|credentials|private|id_rsa|id_ed25519|token|apikey|api_key|password|passwd)(?:$|[._-])|\.(?:pem|key|p12|pfx|der|kdbx|sqlite|db)$/i;

export type WorkspaceFileEntry = {
  path: string;
  format: KnowledgeFormat;
  sizeBytes: number;
};

export type WorkspaceFileInspection = {
  path: string;
  format: KnowledgeFormat;
  sizeBytes: number;
  lineCount: number;
  preview: string;
  content: string;
};

export function validateWorkspacePath(relativePath: string): { normalized: string; format: KnowledgeFormat } {
  const trimmed = relativePath.trim();
  if (!trimmed || trimmed.length > 240) {
    throw new Error('Workspace path must be between 1 and 240 characters.');
  }
  if (trimmed.includes('\0') || trimmed.includes('\\') || trimmed.startsWith('/')) {
    throw new Error('Workspace path must be a relative POSIX path inside the workspace.');
  }
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new Error('Path traversal and empty path segments are blocked.');
    }
    if (segment.startsWith('.')) {
      throw new Error('Dotfiles and hidden directories (.env, .git, etc.) are blocked.');
    }
    if (BLOCKED_SEGMENTS.has(segment.toLowerCase())) {
      throw new Error(`Access to restricted directory "${segment}" is blocked.`);
    }
    if (SENSITIVE_NAME_PATTERN.test(segment)) {
      throw new Error('Access to sensitive or credential-related files is blocked.');
    }
  }
  const ext = extname(trimmed).toLowerCase();
  const format = ALLOWED_EXTENSIONS.get(ext);
  if (!format) {
    throw new Error('Unsupported file extension. Allowed formats: .md, .txt, .json, .ts, .tsx, .py, .js.');
  }
  return { normalized: segments.join('/'), format };
}

export function inspectWorkspaceFile(rootDir: string, relativePath: string, maxBytes = 64000): WorkspaceFileInspection {
  const { normalized, format } = validateWorkspacePath(relativePath);
  const realRoot = realpathSync(resolve(rootDir));
  const segments = normalized.split('/');

  let current = realRoot;
  for (const segment of segments) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      throw new Error('Workspace file not found.');
    }
    if (stat.isSymbolicLink()) {
      throw new Error('Symbolic links are blocked in the workspace inspector.');
    }
  }

  const realTarget = realpathSync(current);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
    throw new Error('Resolved path escapes the workspace boundary.');
  }

  const stat = lstatSync(realTarget);
  if (!stat.isFile()) {
    throw new Error('Target path is not a regular file.');
  }
  if (stat.size === 0 || stat.size > maxBytes) {
    throw new Error(`Workspace file must be non-empty and at most ${maxBytes} bytes.`);
  }

  const buffer = readFileSync(realTarget);
  if (buffer.includes(0)) {
    throw new Error('Binary files cannot be inspected or indexed.');
  }
  const content = buffer.toString('utf8');
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return {
    path: normalized,
    format,
    sizeBytes: stat.size,
    lineCount: lines.length,
    preview: lines.slice(0, 8).join('\n').slice(0, 360),
    content,
  };
}

export function listWorkspaceFiles(rootDir: string, maxFiles = 60): WorkspaceFileEntry[] {
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(rootDir));
  } catch {
    return [];
  }
  const results: WorkspaceFileEntry[] = [];

  const walk = (dir: string, relPrefix: string, depth: number) => {
    if (depth > 3 || results.length >= maxFiles) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      if (entry.name.startsWith('.') || BLOCKED_SEGMENTS.has(entry.name.toLowerCase())) continue;
      if (entry.isSymbolicLink()) continue;
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const fullPath = join(dir, entry.name);
      let stat;
      try {
        stat = lstatSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(fullPath, relPath, depth + 1);
      } else if (stat.isFile() && stat.size > 0 && stat.size <= 64000) {
        if (SENSITIVE_NAME_PATTERN.test(entry.name)) continue;
        const ext = extname(entry.name).toLowerCase();
        const format = ALLOWED_EXTENSIONS.get(ext);
        if (format) {
          results.push({ path: relPath, format, sizeBytes: stat.size });
        }
      }
    }
  };

  walk(realRoot, '', 1);
  return results;
}
