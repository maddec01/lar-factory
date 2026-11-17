import { expect, test } from 'vite-plus/test';

import { $, detailsRead, detailsReply, fetchMock, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

test.each(['merged'] as const)(
    'a Done record leads with its final result and folds old review verdicts (%s PR)',
    async (pr) => {
        const item = {
            ...sample.items.find((work) => work.id === 'I_sample13')!,
            status: 'Done' as const,
            parentId: null,
            parent: null,
            flow: 'single' as const,
            buildPhase: 'review',
            threads: [],
            linkedPrs:
                pr === 'merged'
                    ? [
                          {
                              ...sample.items.find((work) => work.linkedPrs.length)!.linkedPrs[0]!,
                              state: 'merged' as const,
                          },
                      ]
                    : [],
        };
        const board = fresh({ ...sample, items: [item] });

        fetchMock.mockImplementation(async (url: string) => {
            if (detailsRead(url) !== item.id) return new Response(JSON.stringify(board));

            const reply = await detailsReply(item.id).json();

            reply.details.record = {
                bodyKind: 'brief',
                body: 'A completed change.',
                context: '',
                buildPhase: 'review',
                reviewers: [
                    {
                        id: 'code',
                        name: 'Code',
                        status: 'Changes requested',
                        reason: 'Always selected.',
                        result: '0 open findings',
                    },
                ],
                reviewRounds: [
                    { round: 4, reviewers: [{ axis: 'code', verdict: 'request-changes', findings: 1, open: 0 }] },
                ],
            };

            return new Response(JSON.stringify(reply));
        });
        await mountPage(board);

        const { useItemDialogStore } = await import('./ItemDialogStore');

        await settle(() => useItemDialogStore.getState().open(item.id));

        const record = $('[data-item-dialog] [data-record]')!;
        const overview = record.cloneNode(true) as Element;

        overview.querySelectorAll('details').forEach((details) => details.remove());
        expect(text(overview)).toContain(pr === 'merged' ? 'Merged' : 'Done');
        expect(text(overview)).not.toMatch(/Changes requested|Review found changes|Build phase/);
        expect(record.querySelector('[data-build-phase]')).toBeNull();

        const history = [...record.querySelectorAll('summary')].find((node) => text(node) === 'Review history')!;

        expect(history.closest('details')!.open).toBe(false);
        await settle(() => history.click());
        expect(history.closest('details')!.open).toBe(true);
        expect(text(history.closest('details'))).toContain('Code · Changes requested');
    },
);

test('the map preserves Markdown angle-bracket placeholders in item details', async () => {
    const item = {
        ...sample.items.find((work) => work.id === 'I_sample13')!,
        kind: 'concept' as const,
        recorded: true,
        number: 0,
        threads: [],
    };
    const board = fresh({ ...sample, items: [item] });

    fetchMock.mockImplementation(async (url: string) => {
        if (detailsRead(url) !== item.id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(item.id).json();

        reply.details.record = {
            bodyKind: 'map',
            body: '## Destination\nSend <fragment> to <placeholder>. Keep `<code>` literal.',
            context: '',
            buildPhase: null,
            reviewRounds: [],
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const body = $('[data-item-dialog] [data-record-body]');

    expect(text(body)).toContain('Send <fragment> to <placeholder>. Keep <code> literal.');
    expect(text(body?.querySelector('code'))).toBe('<code>');
    expect(body?.querySelector('fragment, placeholder')).toBeNull();
    // A concept's record is its concept map, never "Map", which names the board's view of its parts.
    expect(text($('[data-item-dialog] [data-record]'))).toMatch(/^Concept map/);
});

test('linked work shows readable reviewer and activity overviews with exact output folded in details', async () => {
    const now = '2026-10-21T10:00:00.000Z';
    const command = 'pnpm test && git show 0123456789abcdef0123456789abcdef01234567';
    const result = 'verdict: approve findings: [] consumption: [] escalations: []';
    const reason = 'unmatched: security.no-signal';
    const item = {
        ...sample.items.find((work) => work.id === 'I_sample13')!,
        kind: 'feature' as const,
        flow: 'linked' as const,
        parentId: null,
        parent: null,
        status: 'Shaping' as const,
        number: 0,
        recorded: true,
        threads: [
            {
                id: 'shape',
                title: 'Shape',
                purpose: 'shape',
                state: 'running' as const,
                updated: now,
                currentRunning: true as const,
                activity: {
                    available: true as const,
                    readAt: now,
                    action: 'Running tests',
                    actionDetail: command,
                    actionAt: now,
                    toolRunning: true,
                    agents: [],
                },
            },
        ],
    };
    const board = fresh({ ...sample, items: [item] });

    fetchMock.mockImplementation(async (url: string) => {
        if (detailsRead(url) !== item.id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(item.id).json();

        reply.details.record = {
            bodyKind: 'map',
            body: '# Delivery plan\nShip the linked change.',
            context: '',
            buildPhase: null,
            reviewRounds: [{ round: 1, reviewers: [{ axis: 'ui', verdict: 'skipped', findings: 0, open: 0 }] }],
            reviewers: [
                { id: 'security', name: 'Security', status: 'Completed', reason, result },
                { id: 'ui', name: 'UI', status: 'Skipped', reason: 'No UI changes.' },
            ],
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const dialog = $('[data-item-dialog]')!;
    const overview = dialog.cloneNode(true) as Element;

    overview.querySelectorAll('details').forEach((details) => details.remove());
    expect(text(overview)).toContain('Linked work');
    expect(text(overview)).toContain('Running tests');
    expect(text(overview)).toContain('Review finished; verdict not yet recorded.');
    expect(text(overview)).toContain('UI: Not needed');
    expect(text(overview)).not.toMatch(/Concept map|verdict:|unmatched:|pnpm test|0123456789abcdef/);

    for (const [label, raw] of [
        ['Reviewer details', result],
        ['Activity details', command],
    ]) {
        const summary = [...dialog.querySelectorAll('summary')].find((node) => text(node) === label)!;
        const details = summary.closest('details')!;

        expect(details.open).toBe(false);
        await settle(() => summary.click());
        expect(details.open).toBe(true);
        expect(text(details)).toContain(raw);
    }
});
