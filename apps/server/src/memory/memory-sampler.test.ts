import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, test, vi } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { startMemorySampler, type MemorySample } from './memory-sampler.ts';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

const samplesIn = (file: string) =>
    readFileSync(file, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as MemorySample);
const kinds = (file: string) => samplesIn(file).map((sample) => sample.kind);

test('with the GC variable it samples before and after a forced GC every 5 minutes', (t) => {
    const file = join(tempDir(t, 'lar-memory-'), 'samples.jsonl');
    const stop = startMemorySampler({ BOARD_MEMORY_SAMPLES: file, BOARD_MEMORY_FORCE_GC: '1' });

    t.onTestFinished(stop);
    vi.advanceTimersByTime(299_999);
    assert.ok(!kinds(file).includes('before-gc'));
    vi.advanceTimersByTime(1);

    const taken = kinds(file);

    assert.deepEqual(
        taken.filter((kind) => kind.endsWith('-gc')),
        ['before-gc', 'after-gc'],
    );
    assert.equal(taken.indexOf('after-gc'), taken.indexOf('before-gc') + 1);
});

test('a failed write logs, throws nothing and the next tick tries again', (t) => {
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});

    t.onTestFinished(() => logged.mockRestore());

    const stop = startMemorySampler({
        BOARD_MEMORY_SAMPLES: join(tempDir(t, 'lar-memory-'), 'missing', 'samples.jsonl'),
    });

    t.onTestFinished(stop);
    vi.advanceTimersByTime(30_000);
    assert.equal(logged.mock.calls.length, 2);
    assert.match(String(logged.mock.calls[0]?.[0]), /memory sample failed/);
});
