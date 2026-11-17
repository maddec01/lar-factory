import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, detailsRead, detailsReply, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

const parent = sample.items.find((item) => item.kind === 'concept')!;
const base = sample.items.find((item) => item.kind !== 'concept')!;
const receipt = { by: 'Pedro', at: '2026-11-13T12:00:00Z', evidence: `Manifest SHA256 ${'a'.repeat(64)}` };

function group(kind: 'feature' | 'concept', done: boolean): BoardData {
    const root: Item = {
        ...parent,
        kind,
        flow: 'linked',
        number: 0,
        url: null,
        status: done ? 'Done' : 'In progress',
        parentId: null,
        parent: null,
        threads: [],
        stats: undefined,
        usageState: undefined,
        subIssues: { total: 2, completed: 2 },
        completion: { complete: done, reasons: done ? [] : ['Activation pending.'] },
        releasePlan: {
            steps: [{ id: 'activate', who: 'Pedro', what: 'Activate the merged bundle', done: done ? receipt : null }],
            outcomeCheck: {
                what: 'Check the delivered result',
                result: done ? 'passed' : 'pending',
                evidence: done ? receipt : null,
            },
        },
    };
    const parts: Item[] = ['Server build', 'Apple build'].map((title, index) => ({
        ...base,
        id: `part-${index}`,
        title,
        kind: 'build',
        kindDisagreement: undefined,
        flow: 'linked',
        parentId: root.id,
        parent: { repo: root.repo, number: 0, title: root.title, url: '', state: 'open' },
        status: 'Done',
        state: 'closed',
        completion: { complete: true, reasons: [] },
        threads: [],
        blockers: [],
        subIssues: { total: 0, completed: 0 },
        slices: [],
    }));

    return { ...sample, items: [root, ...parts] };
}

async function show(data: BoardData, body = '', bodyKind: 'brief' | 'map' = 'brief') {
    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(data));

        const reply = await detailsReply(id).json();

        reply.details.record = { bodyKind, body, context: '', buildPhase: null, reviewRounds: [] };
        reply.details.subTickets = [];

        return new Response(JSON.stringify(reply));
    });
    await mountPage(data);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(parent.id));
}

/** A group's status reads in the dialog's summary line, as every item's does. */
const groupStatus = () => text($('[data-item-dialog] [data-item-summary]'));

test('merged parts do not make a parent Delivered while a release step remains', async () => {
    await show(group('feature', false));
    expect(groupStatus()).toContain('Waiting on release step');
    expect(text($('[data-release-progress]'))).toContain('Activation pending.');
    expect(text($('[data-release-progress]'))).toContain('Pending');
});

test('a linked parent with a plan follows delivery in its Status even while its record still says Shaping', async () => {
    const data = group('feature', false);
    const root = data.items[0]!;

    root.status = 'Shaping';
    root.subIssues = { total: 2, completed: 1 };
    data.items[1] = {
        ...data.items[1]!,
        status: 'Review',
        state: 'open',
        completion: { complete: false, reasons: ['PR review pending.'] },
    };
    await show(data, '', 'map');

    expect(groupStatus()).toContain('1/2 parts done');
    expect(groupStatus()).not.toContain('Shaping');
    expect(text($('[data-item-dialog]'))).not.toContain('No delivery plan yet');
    expect(text($('[data-release-progress]'))).toContain('Activation pending.');
});
