import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureVmStatSnapshot,
  parseVmStatOutput,
  profileContextWindowMemoryPressure,
} from '../scripts/memory_profiler.ts';
import { runMemoryPressureBenchmark } from '../scripts/benchmark.ts';

const SAMPLE_VM_STAT_OUTPUT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    30000.
Pages active:                                 250000.
Pages inactive:                               200000.
Pages speculative:                              2000.
Pages throttled:                                   0.
Pages wired down:                             150000.
Pages purgeable:                                8000.
"Translation faults":                       80000000.
Pages copy-on-write:                         2000000.
Pages zero filled:                          85000000.
Pages reactivated:                           7000000.
Pages purged:                                1000000.
File-backed pages:                            150000.
Anonymous pages:                              300000.
Pages stored in compressor:                   500000.
Pages occupied by compressor:                 250000.
Decompressions:                              3000000.
Compressions:                                5000000.
Pageins:                                     4000000.
Pageouts:                                       2000.
`;

test('parseVmStatOutput parses Apple Silicon 16 KiB page size and computes metrics', () => {
  const snapshot = parseVmStatOutput(SAMPLE_VM_STAT_OUTPUT, 100 * 1024 * 1024);

  assert.equal(snapshot.pageSizeBytes, 16384);
  assert.equal(snapshot.pagesFree, 30000);
  assert.equal(snapshot.pagesActive, 250000);
  assert.equal(snapshot.pagesWired, 150000);
  assert.equal(snapshot.pagesCompressed, 250000);
  assert.equal(snapshot.pageFaults, 80000000);

  // Active memory = 250000 * 16384 / (1024 * 1024) = 3906.25 -> 3906 MB
  assert.equal(snapshot.activeMemoryMB, 3906);
  // Wired memory = 150000 * 16384 / (1024 * 1024) = 2343.75 -> 2344 MB
  assert.equal(snapshot.wiredMemoryMB, 2344);
  // Compressed memory = 250000 * 16384 / (1024 * 1024) = 3906 MB
  assert.equal(snapshot.compressedMemoryMB, 3906);
  // Used memory = (250000 + 150000 + 250000) * 16384 / (1024 * 1024) = 10156 MB
  assert.equal(snapshot.usedMemoryMB, 10156);
  // Free memory = 30000 * 16384 / (1024 * 1024) = 469 MB
  assert.equal(snapshot.freeMemoryMB, 469);
  assert.equal(snapshot.processRssMB, 100.0);
});

test('captureVmStatSnapshot captures live process and system memory snapshot', () => {
  const snapshot = captureVmStatSnapshot();
  assert.ok(snapshot.pageSizeBytes > 0);
  assert.ok(snapshot.usedMemoryMB > 0);
  assert.ok(snapshot.processRssMB > 0);
  assert.ok(snapshot.timestampMs > 0);
});

test('profileContextWindowMemoryPressure profiles 4K vs 8K context windows', async () => {
  const profile4k = await profileContextWindowMemoryPressure(4096, 2);
  assert.equal(profile4k.contextTokens, 4096);
  assert.ok(profile4k.baseline.processRssMB > 0);
  assert.ok(profile4k.peak.processRssMB > 0);
  assert.ok(profile4k.deltas.processRssDeltaMB >= 0);
  assert.ok(['NOMINAL', 'ELEVATED', 'CRITICAL'].includes(profile4k.pressureLevel));

  const profile8k = await profileContextWindowMemoryPressure(8192, 2);
  assert.equal(profile8k.contextTokens, 8192);
  assert.ok(profile8k.baseline.processRssMB > 0);
  assert.ok(profile8k.peak.processRssMB > 0);
  assert.ok(profile8k.deltas.processRssDeltaMB >= 0);
});

test('runMemoryPressureBenchmark generates dual 4K/8K benchmark report', async () => {
  const report = await runMemoryPressureBenchmark();
  assert.equal(report.benchmark, 'm-series-memory-profile');
  assert.ok(report.hardware.length > 0);
  assert.equal(report.profile4k.contextTokens, 4096);
  assert.equal(report.profile8k.contextTokens, 8192);
});
