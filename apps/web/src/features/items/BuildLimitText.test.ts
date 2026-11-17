// The Build pane's build-limit heading: what counts toward the limit, and builds with an open PR said apart from it.

import type { BoardData, Item } from '@lar-factory/shared';
import { beforeEach, expect, test } from 'vite-plus/test';

import { $, mountPage, sample, text } from '@/test/PageTest';

const pick = (id: string) => sample.items.find((item) => item.id === id)!;
const openPr = pick('I_sample14').linkedPrs;
const thread = (state: 'running' | 'stopped') => [
    { id: `build-${state}`, title: 'Build', purpose: 'build' as const, state, updated: '2026-10-21T09:00:00.000Z' },
];

/** One build holding a slot, one with an open PR fixing CI and one with an open PR sitting idle. */
const items: Item[] = [
    { ...pick('I_sample22'), buildReserved: true, threads: thread('running') },
    { ...pick('I_sample14'), id: 'fixing-ci', buildReserved: false, linkedPrs: openPr, threads: thread('running') },
    {
        ...pick('I_sample14'),
        id: 'idle-pr',
        number: 77,
        buildReserved: false,
        linkedPrs: openPr,
        threads: thread('stopped'),
    },
];
const data: BoardData = { ...sample, buildLimit: { limit: 2, automatic: 2 }, items };

const heading = () => $('.build-limit')!;

beforeEach(() => localStorage.clear());

test('builds with an open PR, idle or fixing CI, show as waiting on their PR apart from the count', async () => {
    await mountPage(data);

    expect(text(heading())).toBe('1 of 2 build slots · 2 waiting on their PR');
    expect(heading().getAttribute('title')).toContain('2 builds waiting on their PR');
    expect(heading().getAttribute('title')).not.toContain('without a slot');
    expect(text(heading())).not.toContain('more working');
});

test('the limit note says a build with an open PR does not count', async () => {
    await mountPage(data);

    const title = heading().getAttribute('title')!;

    expect(title).toContain("A build with an open PR doesn't count");
    expect(title).not.toContain('A slot releases when its PR closes or merges');
    expect(title).not.toContain('All builds count toward this limit');
});
