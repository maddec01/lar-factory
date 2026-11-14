import { expect, test } from 'vite-plus/test';

import {
    $,
    detailsRead,
    detailsReply,
    fetchMock,
    fresh,
    mountPage,
    posted,
    sample,
    settle,
    text,
    stream,
} from '@/test/PageTest';

const item = {
    ...sample.items.find((work) => work.id === 'I_sample14')!,
    recorded: true,
    status: 'Needs you' as const,
    buildPhase: 'implement' as const,
    passingBrief: false,
    briefApproval: { reason: 'The brief changed during Build.' },
    threads: [],
};
const board = fresh({ ...sample, items: [item] });
const approval = {
    requestId: 'board-request',
    digest: 'batch-digest',
    briefs: [
        {
            workId: item.id,
            title: item.title,
            brief: 'Complete proposed D2 brief.',
            approvalDigest: 'exact-approval-digest',
        },
    ],
};

test('re-gating stays in Build, retains the approved Spec, and requires a second action after displaying the new brief', async () => {
    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/inspect-brief') return new Response(JSON.stringify({ approval, error: null }));

        if (url === '/api/approve-brief')
            return new Response(JSON.stringify({ error: 'The brief changed. Display it again.' }));

        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(id).json();

        reply.details.body = 'Approved D1 Spec.';
        reply.details.record = {
            bodyKind: 'brief',
            body: 'Complete proposed D2 brief.',
            context: '',
            buildPhase: 'implement',
            reviewRounds: [],
        };
        reply.details.spec = {
            outdated: true,
            generation: 1,
            pending: false,
            error: null,
            warning: null,
            original: 'Original.',
            originalFormat: 'markdown',
            held: null,
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);
    expect(text($('.desk-card'))).toContain('Approve brief');
    expect(text($('.desk-card'))).toContain('The brief changed during Build.');

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const dialog = $('[data-item-dialog]')!;

    expect(dialog.querySelector('[data-steps]')?.getAttribute('data-steps')).not.toBeNull();
    expect(text(dialog.querySelector('[data-description]'))).toContain('Out-of-date Spec');
    expect(text(dialog.querySelector('[data-description]'))).toContain('Approved D1 Spec.');
    expect(text(dialog.querySelector('[data-description]'))).not.toContain('Complete proposed D2');

    const button = (label: string) => [...dialog.querySelectorAll('button')].find((node) => text(node) === label)!;

    await settle(() => button('Approve brief').click());
    expect(text(dialog)).toContain('Complete proposed D2 brief.');

    const details = [...dialog.querySelectorAll('details')].find(
        (node) => text(node.querySelector('summary')) === 'Approval details',
    )!;

    expect(details).toBeDefined();
    expect(details.open).toBe(false);
    expect(text(details)).toContain(`Approval digest: ${approval.briefs[0]!.approvalDigest}`);
    expect(text(details)).toContain(`Batch digest: ${approval.digest}`);
    expect(button('Request changes')).toBeDefined();
    expect(posted().some(([url]) => url === '/api/approve-brief')).toBe(false);
    await settle(() => button('Approve displayed brief').click());
    expect(posted()).toContainEqual([
        '/api/approve-brief',
        { itemId: item.id, requestId: approval.requestId, digest: text(details).split('Batch digest: ')[1] },
    ]);
    expect(text(dialog)).toContain('Display it again.');
    expect(button('Approve brief')).toBeDefined();
});

test('successful approval reloads the open dialog so the new Spec replaces the outdated copy', async () => {
    let approved = false;
    const after = fresh({
        ...board,
        items: [{ ...item, status: 'In progress', passingBrief: true, briefApproval: undefined }],
    });

    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/inspect-brief') return new Response(JSON.stringify({ approval, error: null }));

        if (url === '/api/approve-brief') {
            approved = true;

            return new Response(JSON.stringify({ board: after, error: null }));
        }

        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(approved ? after : board));

        const reply = await detailsReply(id).json();

        reply.details.body = approved ? 'Approved D2 Spec.' : 'Approved D1 Spec.';
        reply.details.record = {
            bodyKind: 'brief',
            body: 'Complete proposed D2 brief.',
            context: '',
            buildPhase: 'implement',
            reviewRounds: [],
        };
        reply.details.spec = {
            outdated: !approved,
            generation: approved ? 2 : 1,
            pending: false,
            error: null,
            warning: null,
            original: 'Original.',
            originalFormat: 'markdown',
            held: null,
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const button = (label: string) =>
        [...$('[data-item-dialog]')!.querySelectorAll('button')].find((node) => text(node) === label)!;

    await settle(() => button('Approve brief').click());
    await settle(() => button('Approve displayed brief').click());
    expect(text($('[data-description]'))).toContain('Approved D2 Spec.');
    expect(text($('[data-description]'))).not.toContain('Out-of-date Spec');
    expect(text($('[data-description]'))).not.toContain('Approved D1');
});

test.each(['approve', 'request changes'])(
    'a linked parent keeps batch digests folded and binds %s to the displayed batch',
    async (action) => {
        const parent = {
            ...item,
            id: 'linked-parent',
            kind: 'build' as const,
            flow: 'linked' as const,
            status: 'Shaping' as const,
            briefApproval: undefined,
            buildPhase: null,
        };
        const children = [0, 1].map((index) => ({
            ...item,
            id: `linked-child-${index}`,
            kind: 'build' as const,
            parentId: parent.id,
            status: 'Queued' as const,
            buildPhase: null,
            briefApproval: undefined,
        }));
        const linked = fresh({ ...sample, items: [parent, ...children] });

        fetchMock.mockImplementation(async (url: string) => {
            if (url === '/api/inspect-brief')
                return new Response(
                    JSON.stringify({
                        approval: {
                            ...approval,
                            briefs: children.map((child) => ({
                                ...approval.briefs[0]!,
                                workId: child.id,
                                title: child.title,
                                approvalDigest: `approval-digest-${child.id}`,
                            })),
                        },
                        error: null,
                    }),
                );

            const id = detailsRead(url);

            if (!id) return new Response(JSON.stringify(linked));

            const reply = await detailsReply(item.id).json();

            reply.details.record = {
                bodyKind: 'brief',
                body: 'Linked delivery context; the parent is not a delivery gate.',
                context: '',
                buildPhase: null,
                reviewRounds: [],
            };

            return new Response(JSON.stringify(reply));
        });
        await mountPage(linked);

        const { useItemDialogStore } = await import('./ItemDialogStore');

        await settle(() => useItemDialogStore.getState().open(parent.id));

        const dialog = $('[data-item-dialog]')!;
        const buttons = () => [...dialog.querySelectorAll('button')];

        expect(buttons().filter((button) => text(button) === 'Approve brief')).toHaveLength(0);
        await settle(() =>
            buttons()
                .find((button) => text(button) === 'Approve briefs')!
                .click(),
        );
        expect(posted()).toContainEqual([
            '/api/inspect-brief',
            { itemId: children[0]!.id, workIds: children.map((child) => child.id) },
        ]);
        expect(buttons().find((button) => text(button) === 'Request changes')).toBeDefined();

        const approve = buttons().find((button) => text(button) === 'Approve displayed brief')!;
        const briefs = [...dialog.querySelectorAll('details')].find(
            (node) => text(node.querySelector('summary')) === 'Brief to approve',
        )!;

        expect(approve.compareDocumentPosition(briefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

        const details = [...dialog.querySelectorAll('details')].find(
            (node) => text(node.querySelector('summary')) === 'Approval details',
        )!;

        expect(details).toBeDefined();
        expect(details.open).toBe(false);
        for (const child of children) expect(text(details)).toContain(`Approval digest: approval-digest-${child.id}`);
        expect(text(details)).toContain(`Batch digest: ${approval.digest}`);

        const displayedDigest = text(details).split('Batch digest: ')[1];

        if (action === 'approve') {
            await settle(() =>
                buttons()
                    .find((button) => text(button) === 'Approve displayed brief')!
                    .click(),
            );
            expect(posted()).toContainEqual([
                '/api/approve-brief',
                { itemId: children[0]!.id, requestId: approval.requestId, digest: displayedDigest },
            ]);
        } else {
            await settle(() =>
                buttons()
                    .find((button) => text(button) === 'Request changes')!
                    .click(),
            );

            const input = dialog.querySelector('input')!;

            expect(input.compareDocumentPosition(briefs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

            await settle(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
                    input,
                    'Keep the greeting readable.',
                );
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await settle(() =>
                buttons()
                    .find((button) => text(button) === 'Send change request')!
                    .click(),
            );
            expect(posted()).toContainEqual([
                '/api/request-brief-changes',
                {
                    itemId: children[0]!.id,
                    requestId: approval.requestId,
                    digest: displayedDigest,
                    note: 'Keep the greeting readable.',
                },
            ]);
        }
    },
);

test('an open dialog refreshes the last approved Spec label on each build amendment', async () => {
    let amended = false;

    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(id).json();

        reply.details.body = 'Approved D2 Spec.';
        reply.details.spec = {
            outdated: amended,
            generation: 2,
            pending: false,
            error: null,
            warning: null,
            original: 'Original.',
            originalFormat: 'markdown',
            held: null,
        };

        return new Response(JSON.stringify(reply));
    });

    const initial = fresh({
        ...board,
        items: [{ ...item, revision: 10, staleGate: undefined, passingBrief: true, briefApproval: undefined }],
    });

    await mountPage(initial);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));
    expect(text($('[data-description]'))).not.toContain('Out-of-date Spec');
    amended = true;
    await settle(() =>
        stream().onmessage!(
            new MessageEvent('message', {
                data: JSON.stringify(fresh({ ...board, items: [{ ...item, revision: 11, staleGate: 'brief' }] })),
            }),
        ),
    );
    expect(text($('[data-description]'))).toContain('Out-of-date Spec');
    expect(text($('[data-description]'))).toContain('Approved D2 Spec.');
});

test('details show Doubt reviewing without an approval button for an amended brief', async () => {
    const waiting = fresh({ ...board, items: [{ ...item, briefApproval: undefined, briefReviewing: true as const }] });

    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(waiting));

        const reply = await detailsReply(id).json();

        reply.details.record = {
            bodyKind: 'brief',
            body: 'Proposed D3.',
            context: '',
            buildPhase: 'implement',
            reviewRounds: [],
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(waiting);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));
    expect(text($('[data-record]'))).toContain("Brief changed; Doubt hasn't run");
    expect(
        [...$('[data-item-dialog]')!.querySelectorAll('button')].some((button) =>
            /Approve brief|Display brief/.test(text(button)),
        ),
    ).toBe(false);
    expect($('.desk-card')).toBeNull();
    expect(text($('[data-item-dialog]'))).not.toContain('Needs you:');
});
