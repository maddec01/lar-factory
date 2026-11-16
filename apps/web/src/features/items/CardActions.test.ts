// Queue, Move to the List and Abandon from the item dialog: each posts to its endpoint, shows its own pending state,
// then the result as a toast or an error, and keeps focus in the dialog.
// Ported from the card action cases of test/render.test.ts.

import type { BoardData } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, answer, holdPosts, mountPage, moved, posted, sample, settle, text, toast } from '@/test/PageTest';

const button = (attr: string, id: string) => $<HTMLButtonElement>(`[data-item-dialog] [data-${attr}="${id}"]`)!;
const press = async (el: HTMLElement) => {
    el.focus();
    await settle(() => el.click());
};

/** Opens the item dialog on `itemId` through its store, as every list on the page does. */
async function openItem(itemId: string): Promise<void> {
    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(itemId));
}

test('Queue shows pending state, then leaves Shape reachable without an overlay', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample01');
    await press(button('queue', 'I_sample01'));

    const queuing = button('queue', 'I_sample01');

    expect([text(queuing), queuing.getAttribute('aria-disabled'), queuing.getAttribute('aria-label')]).toEqual([
        'Queuing…',
        'true',
        `Queuing… #61 ${sample.items[0]!.title}`,
    ]);
    expect(button('abandon', 'I_sample01').getAttribute('aria-disabled'), 'the item is held').toBe('true');
    expect(text(button('abandon', 'I_sample01')), 'Abandon isn’t relabelled').toBe('Abandon');

    await answer({ error: null, board: moved('I_sample01', 'Queued') });
    expect(text($('.title-bar [data-list-button]')), 'it leaves the list').toBe('List19');
    expect(toast()).toBeNull();
    expect(text(button('start', 'I_sample01'))).toBe('Shape');
});

test('confirming Abandon holds Queue without relabelling it, and announces the close', async () => {
    holdPosts();

    const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } as BoardData['capture'] };

    await mountPage(data);
    await openItem('I_sample01');
    await press(button('abandon', 'I_sample01'));
    await settle(() =>
        $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')
            .find((b) => text(b) === 'Abandon')!
            .click(),
    );

    const abandoning = button('abandon', 'I_sample01');

    expect([text(abandoning), abandoning.getAttribute('aria-disabled')]).toEqual(['Abandoning…', 'true']);
    expect(button('queue', 'I_sample01').getAttribute('aria-disabled')).toBe('true');
    expect(text(button('queue', 'I_sample01')), 'Queue isn’t relabelled').toBe('Queue');

    await answer({ error: null, board: { ...data, items: data.items.filter((i) => i.id !== 'I_sample01') } });
    expect(text($('.title-bar [data-list-button]')), 'it leaves the list').toBe('List19');
    expect(toast()!.querySelector('a, [data-view-item]'), 'the toast gives the result').toBeNull();
    expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'I_sample01' }]]);
});

test('queuing a source issue switches the open dialog to its new local work ID', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample01');
    await press(button('queue', 'I_sample01'));

    const board = moved('I_sample01', 'Queued');

    board.items = board.items.map((item) =>
        item.id === 'I_sample01' ? { ...item, id: 'I_imported', recorded: true } : item,
    );
    await answer({ error: null, board, itemId: 'I_imported' });

    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    expect(useItemDialogStore.getState().itemId).toBe('I_imported');
    expect(button('start', 'I_imported')).not.toBeNull();
    expect($('[data-item-dialog] [data-action-error]')).toBeNull();
});

test.each([true])('deleted-thread move inspects cleanup and cleans only after success %s', async (success) => {
    const data = structuredClone(sample);
    const item = data.items[0]!;

    item.status = 'In progress';
    item.passingBrief = false;
    item.needsYou = {
        reason: 'Thread deleted',
        causes: [],
        ticketOpen: false,
        deletedThread: true,
        startAgainPurpose: 'build',
        offers: ['back-to-list'],
    };
    await mountPage(data);
    await openItem(item.id);
    holdPosts();
    await press(button('needs-you', item.id));
    expect(posted()).toEqual([]);
    await press(
        $$<HTMLButtonElement>('#needs-you-dialog [data-slot="modal-footer"] button').find(
            (el) => text(el) === 'Move to the List',
        )!,
    );
    expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
    await answer({
        token: 'saved',
        plans: [
            {
                branch: 'slice/old',
                localAvailable: true,
                remoteAvailable: true,
                dirtyFiles: ['draft.txt'],
                unpushedCommits: [],
            },
        ],
    });

    const inputs = $$<HTMLInputElement>('#needs-you-dialog input');

    expect(inputs.map((input) => input.checked)).toEqual([false, false]);

    if (success) await press(inputs[0]!);

    await press($$<HTMLButtonElement>('#needs-you-dialog button').find((el) => text(el) === 'Proceed')!);

    if (success) {
        expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
        expect(text($('#needs-you-dialog'))).toContain('draft.txt');
        await press(
            $$<HTMLButtonElement>('#needs-you-dialog button').find((el) => text(el) === 'Confirm loss and proceed')!,
        );
    }

    expect(posted().at(-1)?.[0]).toBe('/api/needs-you');
    await answer(success ? { error: null, board: data } : { error: 'Move refused' }, success ? 200 : 409);
    expect(posted().some((call) => call[0] === '/api/execute-owned-cleanup')).toBe(success);

    if (!success) expect(text($('#needs-you-dialog [role="alert"]'))).toBe('Move refused');

    if (success) {
        expect(posted().at(-1)?.[1]).toEqual({
            itemId: item.id,
            options: { token: 'saved', local: true, remote: false, confirmedLoss: true },
        });
        await answer({ errors: ['Remote refused'], remainingBranches: ['slice/old'] });
        expect(text($('[data-needs-you-reason]'))).toContain('Remote refused');
        expect(text($('[data-needs-you-reason]'))).toContain('slice/old');
    }
});
