import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, detailsRead, detailsReply, fetchMock, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

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

async function show(data: BoardData, body = '') {
    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(data));

        const reply = await detailsReply(id).json();

        reply.details.record = { bodyKind: 'brief', body, context: '', buildPhase: null, reviewRounds: [] };
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
                  buildReserved: true,
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

test('a large group keeps part holds folded and batch review before delivery details', async () => {
    const data = group('concept', false);
    const root: Item = { ...data.items[0]!, status: 'Shaping' };
    const parts = Array.from({ length: 20 }, (_, index): Item => ({
        ...data.items[1]!,
        id: `waiting-${index}`,
        title: `Greeting fixture ${index + 1}`,
        status: 'Needs you',
        state: 'open',
        passingBrief: false,
        completion: { complete: false, reasons: [] },
        needsYou: {
            reason: `Review fixture ${index + 1}: ${'The complete current contract needs approval. '.repeat(8)}`,
            offers: [],
            causes: [],
            ticketOpen: true,
        },
    }));

    root.conceptBuild = {
        run: null,
        members: parts.map((part) => ({
            workId: part.id,
            title: part.title,
            repository: part.repo!,
            kind: 'build',
            status: part.status,
            complete: false,
            waits: [part.needsYou!.reason],
        })),
        holds: parts.map((part) => ({
            workId: part.id,
            reason: `${part.title}: the current brief needs an approved gate. ${part.needsYou!.reason}`,
        })),
    };
    await show(fresh({ ...data, items: [root, ...parts] }), 'Review the complete group batch.');

    const dialog = $('[data-item-dialog]')!;
    const section = dialog.querySelector('[data-concept-parts]')!;
    const disclosure = section.querySelector('details')!;
    const review = dialog.querySelector('[data-record]')!;

    expect(disclosure, 'per-part holds have a counted disclosure').not.toBeNull();
    expect(text(disclosure.querySelector('summary'))).toBe('20 parts and their holds');
    expect(disclosure.open).toBe(false);
    expect(disclosure.querySelectorAll('[data-row-open]')).toHaveLength(20);

    const holds = dialog.querySelector<HTMLDetailsElement>('[data-concept-build-run] details')!;

    expect(holds.open).toBe(false);
    expect(text(holds.querySelector('summary'))).toBe('Waiting on 20 gates');
    expect(text(holds)).toContain(parts[0]!.needsYou!.reason.trim());
    expect(review.compareDocumentPosition(holds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(review.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
        review.compareDocumentPosition(dialog.querySelector('[data-release-progress]')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect([...review.querySelectorAll('button')].some((button) => text(button) === 'Approve briefs')).toBe(true);
    await settle(() => disclosure.querySelector('summary')!.click());
    expect(disclosure.open).toBe(true);
    await settle(() => disclosure.querySelector<HTMLButtonElement>('[data-row-open]')!.click());
    expect(text($('[data-item-dialog] header'))).toContain('Greeting fixture 1');
});
