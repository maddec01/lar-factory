// Queue, Move to List and Abandon from the item dialog: each posts to its endpoint, shows its own pending state,
// then the result as a toast or an error, and keeps focus in the dialog.
// Ported from the card action cases of test/render.test.ts.

import type { BoardData } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

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
    expect(text($('.title-bar .list-button')), 'it leaves the list').toBe('List3');
    expect(toast()).toBeNull();
    expect(text(button('start', 'I_sample01'))).toContain('Start shaping');
});

test('a failed Move to List shows as a toast naming the item, which stays until closed and hands focus back', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample05');
    await press(button('back-to-list', 'I_sample05'));
    await answer({ error: 'Couldn’t set List. GitHub is down.' }, 502);
    expect(toast()!.getAttribute('role')).toBe('alert');
    expect(toast()!.dataset.toastColor, 'a failure is red').toBe('danger');
    expect(text(toast())).toMatch(/^Couldn’t move #129 .* to List\. Couldn’t set List\. GitHub is down\.$/);
    expect(toast()!.querySelector('a.title'), 'it links the item').not.toBeNull();
    expect($('[data-item-dialog] [data-action-error]'), 'the dialog shows no inline error').toBeNull();
    expect(text(button('back-to-list', 'I_sample05')), 'the footer goes back to its links').toBe('Move to List');
    await settle(() => vi.advanceTimersByTime(60_000));
    expect(toast(), 'a failure stays').not.toBeNull();

    const close = toast()!.querySelector<HTMLButtonElement>('button.dismiss')!;

    expect(close.getAttribute('aria-label')).toBe('Dismiss: error for #129');
    await press(close);
    expect(toast()).toBeNull();
    expect(document.activeElement, 'back to the button that failed').toBe(button('back-to-list', 'I_sample05'));
});

test('Abandon asks first, saying it sets the work aside on this Mac and leaves its ticket open; Cancel returns focus', async () => {
    const warnings = vi.spyOn(console, 'warn');

    await mountPage();
    await openItem('I_sample01');
    await press(button('abandon', 'I_sample01'));

    const dialog = $('#abandon-dialog')!;

    expect(warnings.mock.calls.filter((args) => args.some((arg) => /Missing.*Description/.test(String(arg))))).toEqual(
        [],
    );
    expect(dialog.getAttribute('role')).toBe('alertdialog');
    expect(dialog.querySelector('[data-slot="modal-body"]'), 'no empty detail region or extra tab stop').toBeNull();
    expect(text($('#abandon-dialog h2'))).toBe(`Abandon #61 ${sample.items[0]!.title}?`);
    expect(text(document.getElementById(dialog.getAttribute('aria-describedby')!))).toBe(
        'Abandon sets the work aside on this Mac and leaves its ticket open. Abandon and close ticket closes the ticket first.',
    );
    expect($$('#abandon-dialog [data-slot="modal-footer"] button').map(text)).toEqual([
        'Cancel',
        'Abandon and close ticket',
        'Abandon',
    ]);
    await settle(() => vi.advanceTimersByTime(100));
    expect($('#abandon-dialog [aria-label="Close"]')).toBeNull();
    expect(document.activeElement, 'Cancel takes focus, not the destructive button').toBe(
        $$('#abandon-dialog [data-slot="modal-footer"] button')[0],
    );
    await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[0]!.click());
    await settle(() => vi.advanceTimersByTime(100));
    expect($('#abandon-dialog')).toBeNull();
    expect(document.activeElement).toBe(button('abandon', 'I_sample01'));
    expect(posted(), 'nothing posted').toEqual([]);

    await openItem('I_sample04');
    await press(button('abandon', 'I_sample04'));
    expect(text($('#abandon-dialog h2'))).toMatch(/^Abandon #113 Shared playback history across devices\?$/);
    expect($$('#abandon-dialog [data-slot="modal-footer"] button').map(text)).toEqual([
        'Cancel',
        'Abandon and close ticket',
        'Abandon',
    ]);
    await settle(() => vi.advanceTimersByTime(100));
    await settle(() =>
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    await settle(() => vi.advanceTimersByTime(100));
    expect($('#abandon-dialog'), 'Escape cancels').toBeNull();
    expect($('[data-item-dialog]'), 'and leaves the item dialog open').not.toBeNull();
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
    expect(text($('.title-bar .list-button')), 'it leaves the list').toBe('List3');
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

test('combined tracker failure keeps the confirmation open and allows Cancel', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample01');
    await press(button('abandon', 'I_sample01'));
    await settle(() =>
        $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')
            .find((b) => text(b) === 'Abandon and close ticket')!
            .click(),
    );
    await answer({ error: 'Provider refused closure.' });
    expect(text($('#abandon-dialog [role="alert"]'))).toBe('Provider refused closure.');
    expect($('#abandon-dialog')).not.toBeNull();
    await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[0]!.click());
    expect($('#abandon-dialog')).toBeNull();
    expect(button('abandon', 'I_sample01')).not.toBeNull();
});

test('two lost combined responses block dismissal and board-only recovery until reconciliation', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample01');
    await press(button('abandon', 'I_sample01'));

    /** The footer in ConfirmDialog's order: Cancel, Abandon and close ticket, then the confirming Abandon. */
    const [cancel, abandonAndClose, abandon] = [0, 1, 2].map(
        (n) => () => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[n]!,
    ) as [() => HTMLButtonElement, () => HTMLButtonElement, () => HTMLButtonElement];

    expect(text(abandonAndClose())).toBe('Abandon and close ticket');
    await settle(() => abandonAndClose().click());
    await answer({ error: 'Can’t reach the board server. Try again.' });
    await answer({ error: 'Can’t reach the board server. Try again.' });
    expect(cancel().disabled).toBe(true);
    expect(abandon().disabled).toBe(true);
    expect(abandonAndClose().disabled).toBe(false);
    await settle(() => abandonAndClose().click());
    await answer({ error: 'Provider refused closure.' });
    expect(cancel().disabled).toBe(false);
    expect(abandon().disabled).toBe(false);
});

test.each([
    [[{ type: 'ticket-closed' }], 'Keep working', 'keep-working'],
    [[{ type: 'assignee-changed', from: 'pedro', to: 'sam' }], 'Keep working', 'keep-working'],
    [[], 'Mark as handled', 'mark-handled'],
] as const)(
    'a notice with causes %j posts %s only once confirmed and offers no way to close it otherwise',
    async (causes, label, choice) => {
        const data = structuredClone(sample);
        const item = data.items[0]!;

        item.needsYou = {
            reason: 'Why it waits.',
            causes: [...causes],
            ticketOpen: false,
            offers: [choice, 'set-aside'],
        };
        await mountPage(data);
        await openItem(item.id);
        holdPosts();
        expect($$('[data-needs-you-reason] button').map(text)).toEqual([label, 'Abandon']);
        await press(button('needs-you', item.id));
        expect(posted()).toEqual([]);
        await press(
            $$<HTMLButtonElement>('#needs-you-dialog [data-slot="modal-footer"] button').find(
                (el) => text(el) === label,
            )!,
        );
        expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: item.id, choice }]);
    },
);

test.each([false, true])('deleted-thread move inspects cleanup and cleans only after success %s', async (success) => {
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
            (el) => text(el) === 'Move to List',
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

test('Queue from the list closes details and returns focus to the surviving List search', async () => {
    holdPosts();
    await mountPage();
    await press($<HTMLButtonElement>('.title-bar .list-button')!);
    await press($<HTMLButtonElement>('[data-list-modal] [data-item="I_sample01"]')!);
    await press(button('queue', 'I_sample01'));
    await press(button('queue', 'I_sample01'));
    expect(posted()).toHaveLength(1);
    await answer({ error: null, board: moved('I_sample01', 'Queued') });
    await settle(() => vi.advanceTimersByTime(100));
    expect($('[data-item-dialog]')).toBeNull();
    expect($('[data-list-modal]')).not.toBeNull();
    expect(document.activeElement).toBe($('[data-list-modal] input[type="search"]'));
});

test.each(['replace', 'reopen', 'other', 'closed', 'failure'])(
    'List Queue handles %s without dismissing a later session',
    async (outcome) => {
        holdPosts();
        await mountPage();
        await press($<HTMLButtonElement>('.title-bar .list-button')!);
        await press($<HTMLButtonElement>('[data-list-modal] [data-item="I_sample01"]')!);
        await press(button('queue', 'I_sample01'));

        const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

        if (outcome === 'reopen') {
            await settle(() => useItemDialogStore.getState().close());
            await openItem('I_sample01');
        }

        if (outcome === 'other') await openItem('I_sample05');

        if (outcome === 'closed') await settle(() => useItemDialogStore.getState().close());

        const board = moved('I_sample01', 'Queued');

        if (outcome === 'replace')
            board.items = board.items.map((item) => (item.id === 'I_sample01' ? { ...item, id: 'I_imported' } : item));

        await answer(
            outcome === 'failure'
                ? { error: 'Queue refused' }
                : { error: null, board, ...(outcome === 'replace' && { itemId: 'I_imported' }) },
        );
        expect(useItemDialogStore.getState().itemId).toBe(
            outcome === 'replace' || outcome === 'closed' ? null : outcome === 'other' ? 'I_sample05' : 'I_sample01',
        );

        if (outcome === 'failure') expect(text($('[data-item-dialog] [data-action-error]'))).toContain('Queue refused');
    },
);
