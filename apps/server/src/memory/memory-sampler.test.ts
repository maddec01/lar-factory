import { afterEach, beforeEach, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startMemorySampler, type MemorySample } from './memory-sampler.ts';
import { tempDir } from '../../test/stats-db.ts';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const samplesIn = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as MemorySample);
const kinds = (file: string) => samplesIn(file).map((sample) => sample.kind);

test('it appends a sample with the PID at start, then every 30 seconds', (t) => {
  const file = join(tempDir(t, 'lar-memory-'), 'samples.jsonl');
  const stop = startMemorySampler({ BOARD_MEMORY_SAMPLES: file });
  t.onTestFinished(stop);
  assert.deepEqual(kinds(file), ['start']);
  vi.advanceTimersByTime(29_999);
  assert.deepEqual(kinds(file), ['start']);
  vi.advanceTimersByTime(1);
  assert.deepEqual(kinds(file), ['start', 'interval']);
  const [sample] = samplesIn(file);
  assert.equal(sample!.pid, process.pid);
  for (const figure of [sample!.rss, sample!.heapTotal, sample!.heapUsed, sample!.external, sample!.arrayBuffers, sample!.maxRSS]) {
    assert.ok(Number.isFinite(figure) && figure >= 0);
  }
});

test('with the GC variable it samples before and after a forced GC every 5 minutes', (t) => {
  const file = join(tempDir(t, 'lar-memory-'), 'samples.jsonl');
  const stop = startMemorySampler({ BOARD_MEMORY_SAMPLES: file, BOARD_MEMORY_FORCE_GC: '1' });
  t.onTestFinished(stop);
  vi.advanceTimersByTime(299_999);
  assert.ok(!kinds(file).includes('before-gc'));
  vi.advanceTimersByTime(1);
  const taken = kinds(file);
  assert.deepEqual(taken.filter((kind) => kind.endsWith('-gc')), ['before-gc', 'after-gc']);
  assert.equal(taken.indexOf('after-gc'), taken.indexOf('before-gc') + 1);
});

test('stopping ends the samples', (t) => {
  const file = join(tempDir(t, 'lar-memory-'), 'samples.jsonl');
  startMemorySampler({ BOARD_MEMORY_SAMPLES: file })();
  vi.advanceTimersByTime(120_000);
  assert.deepEqual(kinds(file), ['start']);
});

test('with both variables unset it writes nothing and sets no timer', () => {
  const stop = startMemorySampler({});
  assert.equal(vi.getTimerCount(), 0);
  stop();
});

test('the GC variable without a samples file logs, forces no GC and sets no timer', (t) => {
  const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
  t.onTestFinished(() => logged.mockRestore());
  startMemorySampler({ BOARD_MEMORY_FORCE_GC: '1' });
  assert.equal(vi.getTimerCount(), 0);
  assert.match(String(logged.mock.calls[0]?.[0]), /BOARD_MEMORY_FORCE_GC needs BOARD_MEMORY_SAMPLES/);
});

test('a relative path logs and takes no samples', (t) => {
  const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
  t.onTestFinished(() => logged.mockRestore());
  startMemorySampler({ BOARD_MEMORY_SAMPLES: 'samples.jsonl' });
  assert.equal(vi.getTimerCount(), 0);
  assert.equal(existsSync('samples.jsonl'), false);
  assert.match(String(logged.mock.calls[0]?.[0]), /absolute path/);
});

test('a failed write logs, throws nothing and the next tick tries again', (t) => {
  const logged = vi.spyOn(console, 'log').mockImplementation(() => {});
  t.onTestFinished(() => logged.mockRestore());
  const stop = startMemorySampler({ BOARD_MEMORY_SAMPLES: join(tempDir(t, 'lar-memory-'), 'missing', 'samples.jsonl') });
  t.onTestFinished(stop);
  vi.advanceTimersByTime(30_000);
  assert.equal(logged.mock.calls.length, 2);
  assert.match(String(logged.mock.calls[0]?.[0]), /memory sample failed/);
});
