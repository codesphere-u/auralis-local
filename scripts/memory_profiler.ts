/**
 * Apple Silicon unified memory pressure profiler for Auralis-Local.
 * Queries macOS `vm_stat` and `process.memoryUsage()` to record memory pressure,
 * page faults, and unified memory footprint deltas across 4K vs 8K context windows.
 */

import { execSync } from 'node:child_process';
import os from 'node:os';

export type VmStatSnapshot = {
  timestampMs: number;
  pageSizeBytes: number;
  pagesFree: number;
  pagesActive: number;
  pagesInactive: number;
  pagesWired: number;
  pagesCompressed: number;
  pageFaults: number;
  activeMemoryMB: number;
  wiredMemoryMB: number;
  compressedMemoryMB: number;
  usedMemoryMB: number;
  freeMemoryMB: number;
  processRssMB: number;
};

export type MemoryPressureProfile = {
  hardware: string;
  contextTokens: 4096 | 8192;
  simulatedTurns: number;
  baseline: {
    processRssMB: number;
    usedMemoryMB: number;
    wiredMemoryMB: number;
    compressedMemoryMB: number;
  };
  peak: {
    processRssMB: number;
    usedMemoryMB: number;
    wiredMemoryMB: number;
    compressedMemoryMB: number;
  };
  deltas: {
    processRssDeltaMB: number;
    systemUsedMemoryDeltaMB: number;
    pageFaultsIncurred: number;
  };
  pressureLevel: 'NOMINAL' | 'ELEVATED' | 'CRITICAL';
  withinUnifiedBudget: boolean;
};

export function parseVmStatOutput(rawOutput: string, processRss: number = 0): VmStatSnapshot {
  let pageSize = 16384; // 16 KiB Apple Silicon default
  const pageMatch = rawOutput.match(/page size of (\d+) bytes/i);
  if (pageMatch) {
    pageSize = parseInt(pageMatch[1], 10);
  }

  const parseVal = (pattern: RegExp): number => {
    const m = rawOutput.match(pattern);
    return m ? parseInt(m[1].replace(/\./g, ''), 10) : 0;
  };

  const pagesFree = parseVal(/Pages free:\s+(\d+)\./);
  const pagesActive = parseVal(/Pages active:\s+(\d+)\./);
  const pagesInactive = parseVal(/Pages inactive:\s+(\d+)\./);
  const pagesWired = parseVal(/Pages wired down:\s+(\d+)\./);
  const pagesCompressed = parseVal(/Pages occupied by compressor:\s+(\d+)\./);
  const pageFaults = parseVal(/"Translation faults":\s+(\d+)\./);

  const activeMemoryMB = Math.round((pagesActive * pageSize) / (1024 * 1024));
  const wiredMemoryMB = Math.round((pagesWired * pageSize) / (1024 * 1024));
  const compressedMemoryMB = Math.round((pagesCompressed * pageSize) / (1024 * 1024));
  const usedMemoryMB = Math.round(((pagesActive + pagesWired + pagesCompressed) * pageSize) / (1024 * 1024));
  const freeMemoryMB = Math.round((pagesFree * pageSize) / (1024 * 1024));
  const processRssMB = Math.round((processRss / (1024 * 1024)) * 100) / 100;

  return {
    timestampMs: Date.now(),
    pageSizeBytes: pageSize,
    pagesFree,
    pagesActive,
    pagesInactive,
    pagesWired,
    pagesCompressed,
    pageFaults,
    activeMemoryMB,
    wiredMemoryMB,
    compressedMemoryMB,
    usedMemoryMB,
    freeMemoryMB,
    processRssMB,
  };
}

export function captureVmStatSnapshot(): VmStatSnapshot {
  const rss = process.memoryUsage().rss;
  if (process.platform === 'darwin') {
    try {
      const output = execSync('vm_stat', { encoding: 'utf8', timeout: 2000 });
      return parseVmStatOutput(output, rss);
    } catch {
      // Fallback if vm_stat command fails
    }
  }

  // Generic fallback for non-macOS or restricted test sandboxes
  const total = os.totalmem();
  const free = os.freemem();
  const usedMB = Math.round((total - free) / (1024 * 1024));
  return {
    timestampMs: Date.now(),
    pageSizeBytes: 16384,
    pagesFree: Math.floor(free / 16384),
    pagesActive: Math.floor((total - free) / 16384),
    pagesInactive: 0,
    pagesWired: 0,
    pagesCompressed: 0,
    pageFaults: 0,
    activeMemoryMB: usedMB,
    wiredMemoryMB: 0,
    compressedMemoryMB: 0,
    usedMemoryMB: usedMB,
    freeMemoryMB: Math.round(free / (1024 * 1024)),
    processRssMB: Math.round((rss / (1024 * 1024)) * 100) / 100,
  };
}

/**
 * Measure memory pressure and page fault deltas across sustained context window allocations.
 */
export async function profileContextWindowMemoryPressure(
  contextTokens: 4096 | 8192,
  simulatedTurns: number = 4,
): Promise<MemoryPressureProfile> {
  const baseline = captureVmStatSnapshot();

  // Deterministically allocate synthetic token embeddings and KV cache structures
  // 1 token in 16-bit float KV cache across 32 layers of 4096 hidden dim ~ 256 KiB/token
  // For lightweight local simulation, allocate Uint8Array proportional to context memory
  const simulatedContextByteSize = contextTokens * 512;
  const allocations: Uint8Array[] = [];

  for (let turn = 0; turn < simulatedTurns; turn++) {
    const chunk = new Uint8Array(simulatedContextByteSize / simulatedTurns);
    // Touch pages to enforce resident physical memory commit
    for (let i = 0; i < chunk.length; i += 4096) {
      chunk[i] = (turn + i) % 256;
    }
    allocations.push(chunk);
  }

  const peak = captureVmStatSnapshot();

  // Clear simulated context
  allocations.length = 0;

  const rssDelta = Math.max(0, Math.round((peak.processRssMB - baseline.processRssMB) * 100) / 100);
  const sysDelta = Math.round((peak.usedMemoryMB - baseline.usedMemoryMB) * 100) / 100;
  const faultsDelta = Math.max(0, peak.pageFaults - baseline.pageFaults);

  let pressure: 'NOMINAL' | 'ELEVATED' | 'CRITICAL' = 'NOMINAL';
  if (peak.compressedMemoryMB > 4096 || rssDelta > 2048) {
    pressure = 'CRITICAL';
  } else if (peak.compressedMemoryMB > 1024 || rssDelta > 512) {
    pressure = 'ELEVATED';
  }

  const hardware = `${os.cpus()[0]?.model || 'Apple Silicon'} (${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB Unified RAM)`;

  return {
    hardware,
    contextTokens,
    simulatedTurns,
    baseline: {
      processRssMB: baseline.processRssMB,
      usedMemoryMB: baseline.usedMemoryMB,
      wiredMemoryMB: baseline.wiredMemoryMB,
      compressedMemoryMB: baseline.compressedMemoryMB,
    },
    peak: {
      processRssMB: peak.processRssMB,
      usedMemoryMB: peak.usedMemoryMB,
      wiredMemoryMB: peak.wiredMemoryMB,
      compressedMemoryMB: peak.compressedMemoryMB,
    },
    deltas: {
      processRssDeltaMB: rssDelta,
      systemUsedMemoryDeltaMB: sysDelta,
      pageFaultsIncurred: faultsDelta,
    },
    pressureLevel: pressure,
    withinUnifiedBudget: peak.usedMemoryMB < (os.totalmem() / (1024 * 1024)) * 0.85,
  };
}
