import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

import type { BoardData } from './model.ts';
import { rebaseSampleTimes } from './sample-clock.ts';
import { sampleActivityFrom } from './thread-activity.ts';

const raw = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;

test('the sample keeps all authored ages while its latest read is fresh', () => {
    const now = Date.parse('2027-01-04T12:00:00Z');
    const moved = sampleActivityFrom(raw, now);
    const delta = now - Date.parse(raw.fetchedAt!);

    expect(moved.fetchedAt).toBe(new Date(now).toISOString());
    for (let i = 0; i < raw.items.length; i++) {
        expect(Date.parse(moved.items[i]!.updatedAt) - Date.parse(raw.items[i]!.updatedAt)).toBe(delta);

        if (raw.items[i]!.closedAt)
            expect(Date.parse(moved.items[i]!.closedAt!) - Date.parse(raw.items[i]!.closedAt!)).toBe(delta);
    }
    expect(raw.fetchedAt).toBe('2026-10-21T10:00:00.000Z');
});

test('details, older comments and checks use the same offset without touching prose or pagination cursors', () => {
    const details = {
        body: 'Written on 2026-10-21T09:30:00Z',
        createdAt: '2026-10-21T09:30:00Z',
        olderCursor: '10',
        $older: [{ createdAt: '2026-10-21T09:00:00Z' }],
        $checks: { finishedAt: '2026-10-21T09:50:00Z' },
    };
    const moved = rebaseSampleTimes(details, 3_600_000);

    expect(moved).toEqual({
        ...details,
        createdAt: '2026-10-21T10:30:00.000Z',
        $older: [{ createdAt: '2026-10-21T10:00:00.000Z' }],
        $checks: { finishedAt: '2026-10-21T10:50:00.000Z' },
    });
});
