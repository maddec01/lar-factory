import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

import { nextAction } from './item-next-action.ts';
import type { BoardData } from './model.ts';

const sample = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;

test.each([
    [31, 'Verify build'],
    [142, 'Review failed checks'],
    [149, 'Review PR'],
    [23, 'Answer in T3'],
])('item #%s has one next action for every surface', (number, label) => {
    expect(nextAction(sample.items.find((item) => item.number === number)!)).toMatchObject({ label });
});

test.each(['running', 'stopped', 'done', 'retained', 'unavailable', 'missing'] as const)(
    'Needs you work opens its thread without answer wording for %s observations',
    (state) => {
        const item = sample.items.find((item) => item.number === 23)!;
        const threads =
            state === 'unavailable'
                ? ('unavailable' as const)
                : state === 'missing'
                  ? []
                  : [
                        {
                            id: 'thread',
                            title: 'Thread',
                            updated: '2026-11-11T10:00:00Z',
                            state: state === 'retained' ? ('needs you' as const) : state,
                            observedAt: state === 'retained' ? '2026-11-11T10:00:00Z' : undefined,
                        },
                    ];

        expect(nextAction({ ...item, threads })).toEqual({ kind: 'thread', label: 'Open thread', threadId: undefined });
    },
);
