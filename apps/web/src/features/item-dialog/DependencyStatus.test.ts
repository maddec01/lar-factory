import { expect, test } from 'vite-plus/test';

import { detailsRead, detailsReply, fetchMock, fresh, mountPage, sample, settle, stream } from '@/test/PageTest';

test.each([false, true])('generated dependency facts supersede retained brief prose, Spec=%s', async (spec) => {
    const item = {
        ...sample.items.find((work) => work.id === 'I_sample14')!,
        kind: 'build' as const,
        status: 'Ready' as const,
        threads: [],
        passingBrief: true,
        blockers: [
            {
                number: 0,
                repo: 'fake/team',
                state: 'open' as const,
                title: 'Proof',
                dependency: {
                    dependencyId: 'proof',
                    revision: 1,
                    owner: 'Sandbox external team',
                    need: 'Numeric v1 proof',
                    ticket: null,
                    named: [],
                    evidence: 'None recorded',
                    met: null,
                    needsReview: false,
                    observation: null,
                },
            },
        ],
    };
    const board = fresh({ ...sample, items: [item] });
    const brief = 'Require numeric v1 proof. No proof has been supplied.';

    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(id).json();

        reply.details.body = brief;
        reply.details.record = { bodyKind: 'brief', body: brief, context: '', reviewRounds: [] };

        if (spec)
            reply.details.spec = {
                outdated: false,
                generation: 1,
                pending: false,
                error: null,
                warning: null,
                original: 'Original.',
                held: null,
            };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const dialog = document.querySelector('[data-item-dialog]')!;

    expect(dialog.textContent).toContain('Current dependency status');
    expect(dialog.textContent).toContain('superseded');
    expect(dialog.textContent).toContain('Unmet');
    expect(dialog.textContent).toContain(brief);

    const dependency = item.blockers[0]!.dependency;

    const updated = {
        ...board,
        items: [
            {
                ...item,
                blockers: [
                    {
                        ...item.blockers[0]!,
                        state: 'closed',
                        dependency: {
                            ...dependency,
                            evidence: 'Corrected v1 proof verified',
                            met: { by: 'Pedro', at: '2026-11-14T10:00:00Z' },
                        },
                    },
                ],
            },
        ],
    };

    await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(updated) })));
    expect(dialog.textContent).toContain('Met by Pedro');
    expect(dialog.textContent).toContain('Corrected v1 proof verified');
    expect(dialog.textContent).toContain(brief);
});
