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

/** The work record's buttons, where the brief is displayed and approved. */
const buttons = (dialog: Element, label: string) =>
    [...dialog.querySelectorAll<HTMLButtonElement>('[data-record] button')].filter((node) => text(node) === label);
const inspections = () => posted().filter(([url]) => url === '/api/inspect-brief');

async function type(input: HTMLInputElement, value: string): Promise<void> {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Answers board and details reads with `data` and the item's record holding `body` as its brief. */
function answerReads(data: typeof board, body: string, inspect: () => object, reject?: string) {
    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/inspect-brief') return new Response(JSON.stringify({ error: null, ...inspect() }));

        if (url === '/api/approve-brief' || url === '/api/request-brief-changes')
            return new Response(JSON.stringify({ error: reject ?? null }));

        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(data));

        const reply = await detailsReply(item.id).json();

        reply.details.record = { bodyKind: 'brief', body, context: '', buildPhase: null, reviewRounds: [] };

        return new Response(JSON.stringify(reply));
    });
}

test('re-gating stays in Build, retains the approved Spec, and approves the brief the dialog requested as it opened', async () => {
    let issued = 0;

    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/inspect-brief')
            return new Response(
                JSON.stringify({ approval: { ...approval, requestId: `board-request-${++issued}` }, error: null }),
            );

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
    expect(inspections()).toHaveLength(0);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const dialog = $('[data-item-dialog]')!;

    expect(dialog.querySelector('[data-steps]')?.getAttribute('data-steps')).not.toBeNull();
    expect(text(dialog.querySelector('[data-description]'))).toContain('Out-of-date Spec');
    expect(text(dialog.querySelector('[data-description]'))).toContain('Approved D1 Spec.');
    expect(text(dialog.querySelector('[data-description]'))).not.toContain('Complete proposed D2');
    expect(inspections()).toEqual([['/api/inspect-brief', { itemId: item.id }]]);
    expect(text(dialog).split('Complete proposed D2 brief.')).toHaveLength(2);
    expect(buttons(dialog, 'Approve brief')).toHaveLength(1);
    expect(buttons(dialog, 'Approve displayed brief')).toHaveLength(0);

    const details = [...dialog.querySelectorAll('details')].find(
        (node) => text(node.querySelector('summary')) === 'Approval details',
    )!;

    expect(details).toBeDefined();
    expect(details.open).toBe(false);
    expect(text(details)).toContain(`Approval digest: ${approval.briefs[0]!.approvalDigest}`);
    expect(text(details)).toContain(`Batch digest: ${approval.digest}`);
    expect(buttons(dialog, 'Request changes')[0]!.disabled).toBe(false);
    expect(posted().some(([url]) => url === '/api/approve-brief')).toBe(false);
    await settle(() => buttons(dialog, 'Approve brief')[0]!.click());
    expect(posted()).toContainEqual([
        '/api/approve-brief',
        { itemId: item.id, requestId: 'board-request-1', digest: approval.digest },
    ]);
    // The spent request is replaced by a new one, and the rejection stays until the next action.
    expect(inspections()).toHaveLength(2);
    expect(text(dialog)).toContain('Display it again.');
    expect(buttons(dialog, 'Approve brief')[0]!.disabled).toBe(false);
    await settle(() => buttons(dialog, 'Approve brief')[0]!.click());
    expect(posted()).toContainEqual([
        '/api/approve-brief',
        { itemId: item.id, requestId: 'board-request-2', digest: approval.digest },
    ]);
});

test('a single item without a Spec shows its brief once, and Request changes needs no earlier click', async () => {
    const unbuilt = { ...item, buildPhase: null, briefReviewing: undefined, briefDoubtHold: undefined };
    const unbuiltBoard = fresh({ ...sample, items: [unbuilt] });

    answerReads(unbuiltBoard, 'Complete proposed D2 brief.', () => ({ approval }), 'The request expired.');
    await mountPage(unbuiltBoard);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(unbuilt.id));

    const dialog = $('[data-item-dialog]')!;

    expect(text(dialog).split('Complete proposed D2 brief.')).toHaveLength(2);
    expect(dialog.querySelectorAll('[data-record-body]')).toHaveLength(0);
    expect([...dialog.querySelectorAll('summary')].filter((node) => text(node) === 'Brief to approve')).toHaveLength(1);
    await settle(() => buttons(dialog, 'Request changes')[0]!.click());

    const note = dialog.querySelector<HTMLInputElement>('[data-record] input')!;

    await type(note, 'Name the dialog states.');
    await settle(() => buttons(dialog, 'Send change request')[0]!.click());
    expect(posted()).toContainEqual([
        '/api/request-brief-changes',
        { itemId: unbuilt.id, requestId: approval.requestId, digest: approval.digest, note: 'Name the dialog states.' },
    ]);
    // A rejected change request keeps the note and its editor while a new approval request arrives.
    expect(text(dialog)).toContain('The request expired.');
    expect(inspections()).toHaveLength(2);
    expect(dialog.querySelector<HTMLInputElement>('[data-record] input')!.value).toBe('Name the dialog states.');
});

test('a failed approval request keeps the record body, disables both actions and offers Retry', async () => {
    const unbuilt = { ...item, buildPhase: null, briefReviewing: undefined, briefDoubtHold: undefined };
    const unbuiltBoard = fresh({ ...sample, items: [unbuilt] });
    let fail = true;

    answerReads(unbuiltBoard, 'Complete proposed D2 brief.', () =>
        fail ? { approval: undefined, error: 'The item was set aside.' } : { approval },
    );
    await mountPage(unbuiltBoard);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(unbuilt.id));

    const dialog = $('[data-item-dialog]')!;

    expect(text(dialog)).toContain('The item was set aside.');
    expect(text(dialog)).toContain('Complete proposed D2 brief.');
    expect(buttons(dialog, 'Approve brief')[0]!.disabled).toBe(true);
    expect(buttons(dialog, 'Request changes')[0]!.disabled).toBe(true);
    fail = false;
    await settle(() => buttons(dialog, 'Retry')[0]!.click());
    expect(inspections()).toHaveLength(2);
    expect(text(dialog)).not.toContain('The item was set aside.');
    expect(buttons(dialog, 'Approve brief')[0]!.disabled).toBe(false);
});

test('a single item with a Spec and no build phase offers Approve brief', async () => {
    // A current Doubt: no review running and no hold.
    const unbuilt = { ...item, buildPhase: null, briefReviewing: undefined, briefDoubtHold: undefined };
    const unbuiltBoard = fresh({ ...sample, items: [unbuilt] });

    fetchMock.mockImplementation(async (url: string) => {
        const id = detailsRead(url);

        if (!id) return new Response(JSON.stringify(unbuiltBoard));

        const reply = await detailsReply(id).json();

        reply.details.body = 'Approved D1 Spec.';
        reply.details.record = {
            bodyKind: 'brief',
            body: 'Complete proposed D2 brief.',
            context: '',
            buildPhase: null,
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
    await mountPage(unbuiltBoard);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(unbuilt.id));

    const dialog = $('[data-item-dialog]')!;

    expect(text(dialog.querySelector('[data-description]'))).toContain('Out-of-date Spec');
    expect([...dialog.querySelectorAll('[data-record] button')].some((node) => text(node) === 'Approve brief')).toBe(
        true,
    );
});

test('a linked parent keeps batch digests folded and approves the batch it requested as it opened with one click', async () => {
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
    const all = () => [...dialog.querySelectorAll('button')];

    expect(all().filter((button) => text(button) === 'Approve brief')).toHaveLength(0);
    expect(inspections()).toEqual([
        ['/api/inspect-brief', { itemId: children[0]!.id, workIds: children.map((child) => child.id) }],
    ]);
    expect(buttons(dialog, 'Request changes')[0]!.disabled).toBe(false);
    expect(buttons(dialog, 'Approve displayed brief')).toHaveLength(0);

    const approve = buttons(dialog, 'Approve briefs')[0]!;
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
    await settle(() => approve.click());
    expect(posted()).toContainEqual([
        '/api/approve-brief',
        { itemId: children[0]!.id, requestId: approval.requestId, digest: approval.digest },
    ]);
    // An accepted approval spends its request, so the dialog fetches no other one while the record refreshes.
    expect(inspections()).toHaveLength(1);
    expect(text(dialog)).not.toContain('Fetching the brief to approve.');
});
