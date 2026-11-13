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

async function show(data: BoardData) {
    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(data));

        const reply = await detailsReply(id).json();

        reply.details.record = { bodyKind: 'brief', body: '', context: '', buildPhase: null, reviewRounds: [] };
        reply.details.subTickets = [];

        return new Response(JSON.stringify(reply));
    });
    await mountPage(data);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(parent.id));
}

test.each(['feature', 'concept'] as const)(
    'a delivered %s parent shows delivery, clickable parts and release evidence',
    async (kind) => {
        await show(group(kind, true));

        const dialog = $('[data-item-dialog]')!;

        expect(text(dialog.querySelector('[data-group-status]'))).toBe('Delivered');
        expect(text(dialog)).toContain('2 of 2 builds done');
        expect(text(dialog)).toContain('Delivery complete');
        expect(dialog.querySelector('[data-steps]')).toBeNull();
        for (const noise of [
            'No agent work',
            'No brief',
            'Attach a ticket',
            'Create issue',
            'Planning is saved on this Mac',
        ])
            expect(text(dialog)).not.toContain(noise);

        const parts = dialog.querySelectorAll<HTMLButtonElement>('[data-concept-parts] [data-row-open]');

        expect(parts).toHaveLength(2);
        expect(text(parts[0])).toContain('Server build');
        await settle(() => parts[0]!.click());
        expect(text($('[data-item-dialog] header'))).toContain('Server build');
        expect($('[data-item-dialog] [data-group-status]')).toBeNull();
        expect($('[data-item-dialog] [data-steps]')).not.toBeNull();
    },
);

test('merged parts do not make a parent Delivered while a release step remains', async () => {
    await show(group('feature', false));
    expect(text($('[data-group-status]'))).toBe('Waiting on release step');
    expect(text($('[data-release-progress]'))).toContain('Activation pending.');
    expect(text($('[data-release-progress]'))).toContain('Pending');
});

test('the header counts running builds and then waits for Outcome after release', async () => {
    const data = group('feature', false);
    const items = data.items.map((item, index): Item =>
        index === 0
            ? item
            : {
                  ...item,
                  status: 'In progress',
                  state: 'open',
                  completion: { complete: false, reasons: [] },
                  threads: [
                      { id: `running-${index}`, title: 'Build', state: 'running', updated: new Date().toISOString() },
                  ],
              },
    );

    await show({ ...data, items });
    expect(text($('[data-group-status]'))).toBe('2 builds running');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            items: data.items.map((item, index): Item =>
                index === 0
                    ? {
                          ...item,
                          releasePlan: {
                              ...item.releasePlan!,
                              steps: item.releasePlan!.steps.map((step) => ({ ...step, done: receipt })),
                          },
                      }
                    : item,
            ),
        }),
    );
    expect(text($('[data-group-status]'))).toBe('Waiting on Outcome check');
});
