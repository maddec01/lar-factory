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
    expect(text($('.desk-row'))).toContain('Approve brief');
    expect(text($('.desk-row'))).toContain('The brief changed during Build.');

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const dialog = $('[data-item-dialog]')!;

    expect(dialog.querySelector('[data-steps]')?.getAttribute('data-steps')).not.toBeNull();
    expect(text(dialog.querySelector('[data-description]'))).toContain('Out-of-date Spec');
    expect(text(dialog.querySelector('[data-description]'))).toContain('Approved D1 Spec.');
    expect(text(dialog.querySelector('[data-description]'))).not.toContain('Complete proposed D2');

    /** The work record's button, where the brief is displayed and approved. */
    const button = (label: string) =>
        [...dialog.querySelectorAll<HTMLButtonElement>('[data-record] button')].find((node) => text(node) === label)!;

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

test('a linked parent keeps batch digests folded and binds approval to the displayed batch', async () => {
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

    await settle(() =>
        buttons()
            .find((button) => text(button) === 'Approve displayed brief')!
            .click(),
    );
    expect(posted()).toContainEqual([
        '/api/approve-brief',
        { itemId: children[0]!.id, requestId: approval.requestId, digest: displayedDigest },
    ]);
});
