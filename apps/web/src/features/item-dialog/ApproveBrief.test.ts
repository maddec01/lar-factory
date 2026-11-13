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
    expect(text(dialog)).toContain('exact-approval-digest');
    expect(posted().some(([url]) => url === '/api/approve-brief')).toBe(false);
    await settle(() => button('Approve displayed brief').click());
    expect(posted()).toContainEqual([
        '/api/approve-brief',
        { itemId: item.id, requestId: approval.requestId, digest: approval.digest },
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
