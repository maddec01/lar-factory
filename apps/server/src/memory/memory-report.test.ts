import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { conclude, footprintRegions } from './memory-report.ts';
import type { MemorySample } from './memory-sampler.ts';

const MiB = 2 ** 20;

function sample(
    minute: number,
    rss: number,
    kind: MemorySample['kind'] = 'interval',
    heap: Partial<Pick<MemorySample, 'heapUsed' | 'heapTotal' | 'external'>> = {},
    pid = 7,
): MemorySample {
    return {
        time: new Date(Date.UTC(2026, 10, 5, 12, minute)).toISOString(),
        pid,
        kind,
        rss: rss * MiB,
        heapTotal: (heap.heapTotal ?? 0) * MiB,
        heapUsed: (heap.heapUsed ?? 0) * MiB,
        external: (heap.external ?? 0) * MiB,
        arrayBuffers: 0,
        maxRSS: 0,
    };
}

const region = (dirty: number, swapped = 0) => ({
    dirty: dirty * MiB,
    swapped: swapped * MiB,
    clean: 0,
    reclaimable: 0,
    wired: 0,
    regions: 1,
});
const FOOTPRINT = JSON.stringify({
    processes: [
        {
            pid: 71175,
            footprint: 500 * MiB,
            categories: {
                __TEXT: region(0),
                __DATA: region(30),
                'Malloc Small': region(20, 40),
                'App-Specific Tag 16': region(410),
            },
        },
    ],
});

test('a footprint reads as its total and each region by dirty plus swapped size, the largest first', () => {
    const read = footprintRegions(FOOTPRINT);

    assert.equal(read?.total, 500 * MiB);
    assert.deepEqual(read?.regions.slice(0, 3), [
        { name: 'App-Specific Tag 16', bytes: 410 * MiB },
        { name: 'Malloc Small', bytes: 60 * MiB },
        { name: '__DATA', bytes: 30 * MiB },
    ]);
});

test('the last GC at least 20% above the first is JS retention, even under half of RSS', () => {
    const samples = [
        sample(5, 400, 'after-gc', { heapUsed: 100, heapTotal: 110 }),
        sample(9, 500),
        sample(10, 400, 'after-gc', { heapUsed: 120, heapTotal: 130 }),
    ];

    assert.equal(conclude(samples)?.cause, 'JS retention');

    const flat = [
        sample(5, 400, 'after-gc', { heapUsed: 100, heapTotal: 110 }),
        sample(9, 500),
        sample(10, 400, 'after-gc', { heapUsed: 119, heapTotal: 130 }),
    ];

    assert.equal(conclude(flat)?.cause, 'allocator or native pages');
});
