import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { conclude, footprintRegions, regionsHolding, summarize } from './memory-report.ts';
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

test('a footprint that does not parse reads as null', () => {
    assert.equal(footprintRegions('not JSON'), null);
    assert.equal(footprintRegions('{"processes":[]}'), null);
});

test('the regions holding 80% stop at the first that reaches it', () => {
    const read = footprintRegions(FOOTPRINT)!;

    assert.deepEqual(
        regionsHolding(read, 0.8).map((held) => held.name),
        ['App-Specific Tag 16'],
    );
    assert.deepEqual(
        regionsHolding(read, 0.9).map((held) => held.name),
        ['App-Specific Tag 16', 'Malloc Small'],
    );
});

test('a summary gives the peak, range and end of RSS, and a second PID voids the run', () => {
    const samples = [sample(0, 100), sample(1, 300), sample(2, 50), sample(3, 120)];

    assert.deepEqual(summarize(samples), {
        peak: 300 * MiB,
        peakAt: samples[1]!.time,
        low: 50 * MiB,
        end: 120 * MiB,
        pids: [7],
    });
    assert.deepEqual(summarize([...samples, sample(4, 80, 'start', {}, 8)]).pids, [7, 8]);
});

test('no forced GC gives no conclusion', () => {
    assert.equal(conclude([sample(0, 100), sample(1, 300)]), null);
});

test('heapUsed after GC above half of RSS is JS retention', () => {
    const samples = [sample(4, 500), sample(5, 300, 'after-gc', { heapUsed: 151, heapTotal: 160 })];

    assert.equal(conclude(samples)?.cause, 'JS retention');
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

test('heapTotal slack above half of RSS is V8 heap slack', () => {
    assert.equal(conclude([sample(5, 400, 'after-gc', { heapUsed: 100, heapTotal: 301 })])?.cause, 'V8 heap slack');
});

test('otherwise it is allocator or native pages, using the GC nearest the highest RSS', () => {
    const samples = [
        sample(5, 300, 'after-gc', { heapUsed: 100, heapTotal: 110, external: 9 }),
        sample(9, 600),
        sample(10, 400, 'after-gc', { heapUsed: 100, heapTotal: 120, external: 12 }),
        sample(30, 200, 'after-gc', { heapUsed: 100, heapTotal: 150 }),
    ];
    const conclusion = conclude(samples);

    assert.equal(conclusion?.cause, 'allocator or native pages');
    assert.equal(conclusion?.gc.time, samples[2]!.time);
});
