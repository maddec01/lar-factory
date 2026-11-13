// The item dialog: opened through its store, it shows an item's repository, status and agent work figures in its header,
// a meta area of labels under the title, a progress bar with the slices as an overview, then sub-tickets and pull
// requests in a sidebar, and its footer carries GitHub and the action the item's status asks for.

import type { Blocker, BoardData, DependencyHold, Item, ItemThread } from '@lar-factory/shared';
import { describe, expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    NOW,
    answer,
    fresh,
    holdPosts,
    mountPage,
    moved,
    posted,
    pressMenu,
    push,
    sample,
    settle,
    text,
    toast,
} from '@/test/PageTest';

const dialog = () => $('[data-item-dialog]');
const inDialog = <T extends Element = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const footer = () => inDialog('[data-slot="modal-footer"]')!;
/** The item dialog's `attr` button, not the board's behind it. */
const button = (attr: string, id: string) => inDialog<HTMLButtonElement>(`[data-${attr}="${id}"]`)!;
/** A sidebar section by the start of its heading. */
const section = (heading: string) =>
    $$('[data-item-dialog] aside section').find((s) => text(s.querySelector('h2')).startsWith(heading))!;
const press = async (el: HTMLElement) => {
    el.focus();
    await settle(() => el.click());
};
/** The confirmation a Needs you choice opens. */
const confirmation = () => $('#needs-you-dialog');
const confirmButtons = () => $$<HTMLButtonElement>('#needs-you-dialog [data-slot="modal-footer"] button');
const confirmPress = (name: string) => press(confirmButtons().find((b) => text(b) === name)!);
const without = (id: string): BoardData => ({ ...sample, items: sample.items.filter((i) => i.id !== id) });

/** Opens the item dialog on `itemId` through its store, as every list on the page does. */
async function openItem(itemId: string): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(itemId));
}

/** The footer's buttons and links, left to right, as their text, with " (disabled: <title>)" on a disabled one. */
const footerControls = () =>
    [...footer().querySelectorAll<HTMLElement>('button, a')].map(
        (el) => `${text(el).trim()}${(el as HTMLButtonElement).disabled ? ` (disabled: ${el.title})` : ''}`,
    );

test.each([
    ['Verify', 'Review PR', 'I_sample16'],
    ['Ready to merge', 'Open PR', 'I_sample17'],
])('a %s item with no linked pull request has %s disabled, its title saying why', async (_status, label, itemId) => {
    await mountPage({ ...sample, items: sample.items.map((i) => (i.id === itemId ? { ...i, linkedPrs: [] } : i)) });
    await openItem(itemId);
    expect(footerControls().at(-1)).toBe(`${label} (disabled: No pull request is linked to this item yet)`);
});

/** The sample with `itemId`'s threads replaced. */
const withThreads = (itemId: string, threads: Item['threads'], data: BoardData = sample): BoardData => ({
    ...data,
    items: data.items.map((i) => (i.id === itemId ? { ...i, threads } : i)),
});
const thread = (id: string, state: ItemThread['state']): ItemThread => ({
    id,
    title: `Thread ${id}`,
    state,
    updated: '2026-10-21T09:00:00.000Z',
});
/** The footer's last control: the item's status action. */
const statusAction = () => footer().querySelector<HTMLElement>(':scope > span:last-child > :last-child')!;

test.each([
    [
        'T3 Code’s database can’t be read',
        withThreads('I_sample10', 'unavailable'),
        'The T3 Code database couldn’t be read',
    ],
    [
        'T3 Code’s environment id is missing',
        { ...sample, t3EnvironmentId: undefined },
        'T3 Code hasn’t written its environment id',
    ],
])('Open thread is disabled when %s, and its title says so', async (_case, data, reason) => {
    await mountPage(data);
    await openItem('I_sample10');
    expect(footerControls()).toEqual(['GitHub', `Open thread (disabled: ${reason})`]);
});

test.each([['running'], ['needs you']] as const)(
    'a Queued item with a %s thread offers its thread action instead of Shape, and neither Move to List nor Abandon',
    async (state) => {
        await mountPage(withThreads('I_sample05', [thread('live', state)]));
        await openItem('I_sample05');
        expect(footerControls()).toEqual(['GitHub', state === 'needs you' ? 'Answer in T3' : 'Open thread']);
        expect(statusAction().getAttribute('href')).toBe('t3code://threads/sample-environment/live');
    },
);

test('Queue in the dialog shows it in flight, then shows the item Queued, says so, and moves focus to Shape', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample01');
    await press(button('queue', 'I_sample01'));
    expect([text(button('queue', 'I_sample01')), button('queue', 'I_sample01').getAttribute('aria-disabled')]).toEqual([
        'Queuing…',
        'true',
    ]);
    expect(posted()).toEqual([['/api/queue', { itemId: 'I_sample01' }]]);

    await answer({ error: null, board: moved('I_sample01', 'Queued') });
    expect(text(inDialog('[data-item-summary]'))).toContain(' Queued');
    expect(toast()).toBeNull();
    expect(document.activeElement).toBe(button('start', 'I_sample01'));
});

test('a failed Queue stays in the dialog with a close button, which hands focus back to Queue', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample02');
    await press(button('queue', 'I_sample02'));
    await answer({ error: 'Couldn’t set Queued.' }, 502);
    expect(text(inDialog('[data-action-error] [role="alert"]'))).toBe('Couldn’t set Queued.');

    const close = inDialog<HTMLButtonElement>('[data-action-error] button.dismiss')!;

    await press(close);
    expect(inDialog('[data-action-error]')).toBeNull();
    expect(document.activeElement).toBe(button('queue', 'I_sample02'));
});

test('Shape opens the model menu, and picking a model starts the item and tags it Started', async () => {
    const withChoices: BoardData = {
        ...sample,
        capture: { session: 's1', enabled: true },
        modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }],
    };

    holdPosts(withChoices);
    await mountPage(withChoices);
    await openItem('I_sample05');
    await pressMenu(button('start', 'I_sample05'));
    await settle(() => vi.advanceTimersByTime(20));
    expect($$('[role="menu"] [role="menuitemradio"]').map(text)).toEqual(['Project default in T3', 'GPT-5.5']);
    await settle(() => $$('[role="menu"] [role="menuitemradio"]')[1]!.click());
    expect(posted()).toEqual([
        ['/api/start', { session: 's1', itemId: 'I_sample05', model: { instanceId: 'codex', model: 'gpt-5.5' } }],
    ]);
    expect(text(button('start', 'I_sample05'))).toBe('Starting…');

    const thread = { threadId: 'thread-1', title: 'Other title' };

    await answer({ thread, error: null, board: { ...withChoices, started: { I_sample05: thread } } });

    const tag = inDialog('[data-start-result="I_sample05"]')!;

    expect(text(tag)).toBe('Started');
    expect(document.activeElement, 'focus moves to the dialog’s tag').toBe(tag);
    expect(inDialog('[data-back-to-list], [data-abandon]'), 'a started item can’t go back').toBeNull();
    expect(text(toast())).toBe('Refining started for #129. Open thread');
});

test('a failed Start shows in the dialog and offers Retry start', async () => {
    holdPosts();
    await mountPage({ ...sample, capture: { session: 's1', enabled: true } });
    await openItem('I_sample05');
    await pressMenu(button('start', 'I_sample05'));
    await settle(() => vi.advanceTimersByTime(20));
    await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
    await answer({ error: 'T3 isn’t running.' }, 502);
    expect(text(inDialog('.start [role="alert"]'))).toBe('T3 isn’t running.');
    expect(text(button('start', 'I_sample05'))).toBe('Retry start');
});

/** The sample with #140's blocker closed, so its Start build runs, and writes on. */
const readyBuild: BoardData = {
    ...withThreads('I_sample13', undefined),
    capture: { session: 's1', enabled: true },
    items: sample.items.map((i) =>
        i.id === 'I_sample13' ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }] } : i,
    ),
};

test('Start build in a Ready item’s footer sends the build, then tags it Started', async () => {
    holdPosts(readyBuild);
    await mountPage(readyBuild);
    await openItem('I_sample13');
    expect(footerControls()).toEqual(['GitHub', 'Open thread', 'Start build']);
    await pressMenu(button('start', 'I_sample13'));
    await settle(() => vi.advanceTimersByTime(20));
    await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
    expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13' }]]);

    const thread = { threadId: 'thread-1', title: 'Build maddec01/lar-server#140' };

    await answer({ thread, error: null, board: { ...readyBuild, startedBuilds: { I_sample13: thread } } });
    expect(text(inDialog('[data-start-result="I_sample13"]'))).toBe('Started');
});

test('a failed Start build shows in the dialog and offers Retry start', async () => {
    holdPosts(readyBuild);
    await mountPage(readyBuild);
    await openItem('I_sample13');
    await pressMenu(button('start', 'I_sample13'));
    await settle(() => vi.advanceTimersByTime(20));
    await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
    await answer(
        { thread: null, error: 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code' },
        409,
    );
    expect(text(inDialog('.start [role="alert"]'))).toBe(
        'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code',
    );
    expect(text(button('start', 'I_sample13'))).toBe('Retry start');
});

test('Move to List in the dialog shows the item in the list, says so, and moves focus to Queue', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample05');
    await press(button('back-to-list', 'I_sample05'));
    expect(text(button('back-to-list', 'I_sample05'))).toBe('Moving to List…');
    expect(posted()).toEqual([['/api/back-to-list', { itemId: 'I_sample05' }]]);
    await answer({ error: null, board: moved('I_sample05', 'List') });
    expect(text(toast())).toMatch(/^Moved #129 .* to List\. View item$/);
    expect(document.activeElement).toBe(button('queue', 'I_sample05'));
});

test('a failed Move to List is a toast, and focus goes back to Move to List', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample05');
    await press(button('back-to-list', 'I_sample05'));
    await answer({ error: 'GitHub is down.' }, 502);
    expect(text(toast())).toMatch(/^Couldn’t move #129 .* to List\. GitHub is down\.$/);
    expect(document.activeElement).toBe(button('back-to-list', 'I_sample05'));
});

test('Abandon in the dialog sets work aside without a follow-up ticket confirmation', async () => {
    holdPosts();

    const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } };

    await mountPage(data);
    await openItem('I_sample01');
    await press(button('abandon', 'I_sample01'));
    expect(text($('#abandon-dialog h2'))).toMatch(/#61/);
    await abandonPress('Abandon');
    expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'I_sample01' }]]);
    expect(text(button('abandon', 'I_sample01'))).toBe('Abandoning…');
    await answer({ error: null, board: without('I_sample01') });
    expect(text(toast())).toBe(`Set #61 ${sample.items[0]!.title} aside on this Mac.`);
    expect($('[data-item-dialog]'), 'the dialog closes').toBeNull();
    expect($('#abandon-dialog')).toBeNull();
    expect(posted().map(([path]) => path)).toEqual(['/api/abandon']);
});

test('a failed Abandon retains its confirmation, inline error and focus', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample01');
    await press(button('abandon', 'I_sample01'));
    await abandonPress('Abandon');
    await answer({ error: 'Couldn’t abandon #61.' }, 502);
    expect(text(toast())).toMatch(/^Couldn’t abandon #61 .*\. Couldn’t abandon #61\.$/);
    expect(inDialog('[data-action-error]'), 'no inline error').toBeNull();
    await settle(() => vi.advanceTimersByTime(20));
    expect($('#abandon-dialog')?.getAttribute('role')).toBe('alertdialog');
    expect(text($('#abandon-dialog [data-slot="alert"]'))).toBe('Couldn’t abandon #61.');
    expect($('#abandon-dialog')?.contains(document.activeElement)).toBe(true);
});

const abandonButtons = () => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button');
const abandonPress = (name: string) => press(abandonButtons().find((b) => text(b) === name)!);
/** The sentence the confirmation is described by, which says what Abandon does. */
const abandonDetail = () =>
    document.getElementById($('#abandon-dialog')?.getAttribute('aria-describedby') ?? '') ?? null;
const boxes = () => $$<HTMLLabelElement>('#abandon-dialog label');
const tick = (name: string) =>
    settle(() =>
        boxes()
            .find((box) => text(box).includes(name))!
            .querySelector('input')!
            .click(),
    );
const closedPlan = {
    branch: 'build/old',
    localBranches: ['build/old'],
    worktreePaths: [],
    remoteBranch: 'build/old',
    localAvailable: true,
    remoteAvailable: true,
    dirtyFiles: [],
    unpushedCommits: [],
};

/** Presses Abandon on a Review item's notice: its confirmation is open, and its inspection is the post in flight. */
async function abandonFromNotice(ticketOpen = false) {
    const id = 'I_sample05';
    const data: BoardData = {
        ...sample,
        capture: { enabled: true, session: 's1' },
        items: sample.items.map((i) =>
            i.id === id
                ? {
                      ...i,
                      status: 'Review',
                      needsYou: {
                          reason: 'Its PR closed.',
                          offers: ['set-aside'],
                          causes: [{ type: 'pr-closed' }],
                          ticketOpen,
                      },
                  }
                : i,
        ),
    };

    await mountPage(data);
    holdPosts(data);
    await openItem(id);
    await press(button('abandon', id));
    expect(posted()).toEqual([['/api/inspect-owned-cleanup', { itemId: id }]]);

    return id;
}

test('Abandon on a notice asks with both cleanup boxes unticked and the remote warning, and Cancel changes nothing', async () => {
    const id = await abandonFromNotice();

    expect(text($('#abandon-dialog [role="status"]'))).toMatch(/^Checking/);
    expect(abandonButtons()[1]!.disabled, 'Abandon waits for the answer').toBe(true);
    await answer({ token: 't1', plans: [closedPlan] });
    expect(text(abandonDetail())).toBe(
        'This moves the item off the desk into Settings › Archive. Its ticket stays as it is. Any PR it has stays as it is.',
    );
    expect(text($('#abandon-dialog')), 'the boxes ask about the branch and worktree').not.toContain(
        'no branch or worktree it can remove',
    );
    expect(
        boxes().map((box) => text(box).trim()),
        'each box names its branches',
    ).toEqual(['Remove old local worktrees and branches: build/old', 'Delete pushed remote branch: build/old']);
    expect(boxes().map((box) => box.querySelector('input')!.checked)).toEqual([false, false]);
    expect(text($('#abandon-dialog'))).toContain(
        'Deleting the remote branch of a closed PR can stop it being reopened, including after a restore from Archive.',
    );
    expect(abandonButtons().map(text), 'a closed ticket has nothing to close').toEqual(['Cancel', 'Abandon']);
    await abandonPress('Cancel');
    expect(posted().map(([path]) => path)).toEqual(['/api/inspect-owned-cleanup']);
    expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
    expect(button('abandon', id)).not.toBeNull();
});

const NOTHING_TO_REMOVE = 'The board has no branch or worktree it can remove for this work, so anything there stays.';

for (const [name, plan] of [
    [
        'an unpushed branch in a live worktree',
        { ...closedPlan, localBranches: [], remoteBranch: null, localAvailable: false, remoteAvailable: false },
    ],
    ['a pushed branch with an open PR', { ...closedPlan, localAvailable: false, remoteAvailable: false }],
] as const)
    test(`Abandon on a notice with ${name} says the board can remove nothing, with no box to tick`, async () => {
        await abandonFromNotice();
        await answer({ token: 't1', plans: [plan] });
        expect(boxes()).toEqual([]);
        expect(text($('#abandon-dialog'))).toContain(NOTHING_TO_REMOVE);
        expect(text($('#abandon-dialog'))).not.toContain('Unticked');
    });

test('ticked cleanup with something to lose confirms the loss, runs first, then closes the ticket', async () => {
    const id = await abandonFromNotice(true);

    await answer({
        token: 't1',
        plans: [{ ...closedPlan, dirtyFiles: ['/w: M a.ts'], unpushedCommits: ['build/old: abc Work'] }],
    });
    await tick('Remove old');
    await abandonPress('Abandon and close ticket');
    expect(posted(), 'the first press only shows the loss').toHaveLength(1);

    const loss = $('#abandon-dialog [data-cleanup-loss]')!;

    expect(loss.getAttribute('role'), 'the list is announced').toBe('alert');
    expect(
        // oxlint-disable-next-line typescript/unbound-method -- reads the mock's recorded calls; nothing calls it unbound
        vi.mocked(HTMLElement.prototype.scrollIntoView).mock.contexts,
        'the list scrolls into view above the buttons',
    ).toContain(loss.parentElement);
    expect(text(loss.querySelector('li > span'))).toBe('build/old');
    expect(
        $$('#abandon-dialog [data-cleanup-loss] ul ul li').map(text),
        'each line drops the branch it sits under',
    ).toEqual(['/w: M a.ts', 'abc Work']);
    await abandonPress('Confirm loss, abandon and close ticket');
    expect(posted().at(-1)).toEqual([
        '/api/execute-owned-cleanup',
        { itemId: id, options: { token: 't1', local: true, remote: false, confirmedLoss: true } },
    ]);
    await answer({ errors: [], remainingBranches: ['build/old'] });
    expect(posted().at(-1), 'unticked remaining branches are no failure').toEqual([
        '/api/abandon-and-close',
        { itemId: id },
    ]);
});

test('a cleanup error keeps the item and ticket, and offers a fresh retry or the same Abandon without further cleanup', async () => {
    const id = await abandonFromNotice(true);

    await answer({ token: 't1', plans: [closedPlan] });
    await tick('Delete pushed');
    await abandonPress('Abandon and close ticket');
    await answer({ errors: ['Couldn’t delete remote branch build/old'], remainingBranches: ['build/old'] });
    expect(
        posted().map(([path]) => path),
        'the ticket stays alone',
    ).toEqual(['/api/inspect-owned-cleanup', '/api/execute-owned-cleanup']);
    expect(text($('#abandon-dialog [data-slot="alert"]'))).toContain('Couldn’t delete remote branch build/old');
    expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
    expect(abandonButtons().map(text)).toEqual([
        'Cancel',
        'Try cleanup again',
        'Abandon and close ticket without further cleanup',
    ]);
    expect(abandonButtons().at(-1)!.dataset.wrap, 'a long label wraps instead of clipping at 320 px').toBeDefined();
    await abandonPress('Try cleanup again');
    expect(posted().at(-1)).toEqual(['/api/inspect-owned-cleanup', { itemId: id }]);
    await answer({ token: 't2', plans: [closedPlan] });
    expect(
        boxes().map((box) => box.querySelector('input')!.checked),
        'the retry keeps the ticks',
    ).toEqual([false, true]);
    await abandonPress('Abandon');
    expect(posted().at(-1)).toEqual([
        '/api/execute-owned-cleanup',
        { itemId: id, options: { token: 't2', local: false, remote: true, confirmedLoss: false } },
    ]);
    await answer({ error: 'Cleanup changed. Inspect and confirm again.' }, 409);
    await abandonPress('Abandon without further cleanup');
    expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
    expect(posted().filter(([path]) => path === '/api/execute-owned-cleanup')).toHaveLength(2);
});

test('a failed Abandon after cleanup keeps the confirmation, and its retry doesn’t clean up again', async () => {
    const id = await abandonFromNotice();

    await answer({ token: 't1', plans: [closedPlan] });
    await tick('Remove old');
    await abandonPress('Abandon');
    await answer({ errors: [], remainingBranches: [] });
    expect(posted().at(-1)?.[0]).toBe('/api/abandon');
    await answer({ error: 'Couldn’t abandon.' }, 409);
    expect(text($('#abandon-dialog [data-slot="alert"]'))).toBe('Couldn’t abandon.');
    expect(toast(), 'the confirmation shows the failure, so no toast covers its buttons').toBeNull();
    await abandonPress('Abandon');
    expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
    expect(posted().filter(([path]) => path === '/api/execute-owned-cleanup')).toHaveLength(1);
});

test('an item that leaves the board closes the dialog for good: its coming back later opens nothing', async () => {
    await mountPage();
    await openItem('I_sample13');

    const { useItemDialogStore } = await import('./ItemDialogStore');
    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(without('I_sample13')));
    expect(useItemDialogStore.getState().itemId).toBeNull();
    await settle(() => useBoardStore.getState().receive(sample));
    expect(dialog()).toBeNull();
});

test('closing the dialog clears the store, and Escape closes it', async () => {
    await mountPage();
    await openItem('I_sample13');

    const { useItemDialogStore } = await import('./ItemDialogStore');
    const popup = dialog()!;

    await settle(() => popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(useItemDialogStore.getState().itemId).toBeNull();
    expect(dialog()).toBeNull();
});

test('work that needs you shows why, confirms each choice before posting it, offers no Clear, and sets the work aside through Abandon', async () => {
    holdPosts();

    const id = 'I_sample05';
    const reason = 'Its PR closed without merging.';

    await mountPage({
        ...sample,
        capture: { enabled: true, session: 'session-1' },
        items: sample.items.map((i) =>
            i.id === id
                ? {
                      ...i,
                      status: 'Review',
                      needsYou: {
                          reason,
                          offers: ['reopen-pr', 'replace-pr', 'set-aside'],
                          causes: [{ type: 'pr-closed' }, { type: 'ticket-closed' }],
                          ticketOpen: false,
                      },
                  }
                : i,
        ),
    });
    await openItem(id);
    expect(text(inDialog('[data-needs-you-reason]'))).toContain(reason);
    expect($$('[data-needs-you-reason] button').map(text)).toEqual([
        'Reopen PR',
        'Start a replacement build',
        'Abandon',
    ]);
    await press($$<HTMLButtonElement>('[data-needs-you-reason] button')[0]!);
    expect(posted(), 'pressing a choice writes nothing').toEqual([]);
    expect(confirmation()!.getAttribute('role')).toBe('alertdialog');
    expect(text($('#needs-you-detail'))).toContain('Its ticket stays closed.');
    expect(confirmButtons().map(text)).toEqual(['Cancel', 'Reopen PR']);
    await confirmPress('Reopen PR');
    expect(posted()).toEqual([['/api/needs-you', { itemId: id, choice: 'reopen-pr' }]]);
    await answer({ error: 'Couldn’t reopen the PR.' }, 502);
    expect(text($('#needs-you-dialog [data-slot="alert"]')), 'the failure stays in the confirmation').toBe(
        'Couldn’t reopen the PR.',
    );
    expect(inDialog('[data-action-error] [role="alert"]')).toBeNull();
    expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
    await confirmPress('Try again');
    expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: id, choice: 'reopen-pr' }]);
    expect(posted()).toHaveLength(2);
    await answer({ error: null });
    expect(confirmation()).toBeNull();
    await press($$<HTMLButtonElement>('[data-needs-you-reason] button')[1]!);
    expect(text($('#needs-you-dialog h2'))).toMatch(/^Start a replacement build for #129 /);
    await confirmPress('Start a replacement build');
    expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: id, choice: 'replace-pr' }]);
    await answer({ error: null });
    await press($$<HTMLButtonElement>('[data-needs-you-reason] button')[2]!);
    expect(text($('#abandon-dialog h2'))).toMatch(/^Abandon #129 /);
});

test('Cancel and Escape leave the notice and post nothing, and the choice takes focus back', async () => {
    holdPosts();

    const id = 'I_sample05';

    await mountPage({
        ...sample,
        capture: { enabled: true, session: 'session-1' },
        items: sample.items.map((i) =>
            i.id === id
                ? {
                      ...i,
                      status: 'Review',
                      needsYou: {
                          reason: 'Why.',
                          offers: ['keep-working', 'set-aside'],
                          causes: [{ type: 'ticket-closed' }],
                          ticketOpen: false,
                      },
                  }
                : i,
        ),
    });
    await openItem(id);
    await press(button('needs-you', id));
    await confirmPress('Cancel');
    await settle(() => vi.advanceTimersByTime(100));
    expect(confirmation()).toBeNull();
    expect(document.activeElement).toBe(button('needs-you', id));
    await press(button('needs-you', id));
    await settle(() => vi.advanceTimersByTime(100));
    await settle(() =>
        document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    await settle(() => vi.advanceTimersByTime(100));
    expect(confirmation(), 'Escape cancels').toBeNull();
    expect(dialog(), 'and leaves the item dialog open').not.toBeNull();
    expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
    expect(posted()).toEqual([]);
});

/** A Dependency on the server team blocking a build, its ticket read an hour before NOW as `kind`. */
function dependencyBlocker(
    kind: NonNullable<DependencyHold['observation']>['kind'],
    change: Partial<DependencyHold> = {},
): Blocker {
    const hold: DependencyHold = {
        dependencyId: 'dep-1',
        revision: 3,
        owner: 'server team',
        need: 'An export endpoint',
        ticket: 'maddec01/lar-server#40',
        named: [{ reference: 'maddec01/lar-server#40', url: 'https://github.com/maddec01/lar-server/issues/40' }],
        evidence: 'The endpoint answers in staging',
        met: null,
        needsReview: false,
        observation: {
            subject: 'maddec01/lar-server#40',
            kind,
            detail: null,
            observedAt: '2026-10-21T09:00:00Z',
            lastGood: null,
        },
        ...change,
    };

    return {
        number: 40,
        repo: 'maddec01/lar-server',
        state: hold.met ? 'closed' : 'open',
        title: hold.need,
        dependency: hold,
    };
}

const withDependency = (blocker: Blocker): BoardData => ({
    ...sample,
    capture: { enabled: true, session: 'session-1' },
    items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, blockers: [blocker] } : i)),
});
const dependencyRow = () => inDialog('[data-dependency="dep-1"]')!;

test('a Dependency shows its team, ticket, latest read and evidence, suggests Mark met once its ticket closed, and posts the mark', async () => {
    holdPosts();
    await mountPage(withDependency(dependencyBlocker('closed')));
    await openItem('I_sample13');
    expect(text(inDialog('[data-item-summary] > div'))).toContain('Blocked · starts after Dependency on server team');
    expect(text(section('Dependencies').querySelector('[data-dependency-owner]'))).toBe(
        'Dependency on server team · not met',
    );
    expect(text(dependencyRow())).toContain('An export endpoint');
    expect(text(dependencyRow().querySelector('[data-dependency-read]'))).toBe(
        'maddec01/lar-server#40 closed, read 1h ago',
    );

    const ticket = dependencyRow().querySelector<HTMLAnchorElement>('[data-dependency-read] a')!;

    expect([text(ticket), ticket.href, ticket.target], 'its ticket opens in the browser').toEqual([
        'maddec01/lar-server#40',
        'https://github.com/maddec01/lar-server/issues/40',
        '_blank',
    ]);
    expect(text(dependencyRow().querySelector('[data-dependency-evidence]'))).toBe(
        'Evidence: The endpoint answers in staging',
    );
    expect(text(dependencyRow().querySelector('[data-dependency-notice]'))).toBe(
        'Its ticket maddec01/lar-server#40 is closed. Mark it met once the change is delivered.',
    );
    expect(footerControls()).toEqual(['GitHub', 'Open thread', 'Start after server team']);
    expect(inDialog<HTMLButtonElement>('[data-start-after]')!.title).toBe(
        'Pick a model to start it once you mark the Dependency on server team met',
    );
    expect(dependencyRow().querySelector('button')!.getAttribute('aria-label')).toMatch(
        /^Mark the Dependency on server team met: #140 /,
    );
    await press(dependencyRow().querySelector<HTMLButtonElement>('button')!);
    expect(posted()).toEqual([
        ['/api/dependency-met', { itemId: 'I_sample13', dependencyId: 'dep-1', revision: 3, met: true }],
    ]);
    await answer({ error: 'The Dependency dep-1 is at revision 4, not 3; read it again and retry.' }, 409);
    expect(text(inDialog('[data-action-error] [role="alert"]'))).toBe(
        'The Dependency dep-1 is at revision 4, not 3; read it again and retry.',
    );
});

test('a met Dependency whose ticket changed since asks for a review, offers to clear the mark and no longer blocks', async () => {
    holdPosts();
    await mountPage(
        withDependency(
            dependencyBlocker('reopened', { met: { by: 'pedro', at: '2026-10-21T08:00:00Z' }, needsReview: true }),
        ),
    );
    await openItem('I_sample13');
    expect(text(inDialog('[data-item-summary] > div'))).not.toContain('Blocked by');
    expect(text(section('Dependencies').querySelector('[data-dependency-owner]'))).toBe(
        'Dependency on server team · met, marked by pedro 2h ago',
    );
    expect(text(dependencyRow().querySelector('[data-dependency-notice]'))).toBe(
        'Its ticket maddec01/lar-server#40 changed to reopened after you marked it met. Review the mark.',
    );

    const clear = dependencyRow().querySelector<HTMLButtonElement>('button')!;

    expect(text(clear)).toBe('Clear met mark');
    expect(clear.getAttribute('aria-label')).toMatch(/^Clear the met mark on the Dependency on server team: #140 /);
    await press(clear);
    expect(posted()).toEqual([
        ['/api/dependency-met', { itemId: 'I_sample13', dependencyId: 'dep-1', revision: 3, met: false }],
    ]);
});

test('Back to Queue asks first and sends the move only once confirmed', async () => {
    const id = 'I_sample05';
    const data: BoardData = {
        ...sample,
        capture: { enabled: true, session: 's1' },
        items: sample.items.map((i) =>
            i.id === id
                ? {
                      ...i,
                      status: 'Review',
                      passingBrief: false,
                      needsYou: {
                          reason: 'Deleted',
                          causes: [],
                          ticketOpen: false,
                          deletedThread: true,
                          offers: ['back-to-queue'],
                      },
                  }
                : i,
        ),
    };

    await mountPage(data);
    holdPosts(data);
    await openItem(id);
    await press(button('needs-you', id));
    expect(posted()).toEqual([]);
    await confirmPress('Back to Queue');
    expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
    await answer({ token: 'empty', plans: [] });
    expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: id, choice: 'back-to-queue' }]);
});

async function recoveryItem(
    build = true,
    needsYou: Partial<NonNullable<Item['needsYou']>> = {
        reason: 'Deleted work thread',
        causes: [],
        deletedThread: true,
    },
) {
    const id = 'I_sample05';
    const data: BoardData = {
        ...sample,
        capture: { enabled: true, session: 's1' },
        items: sample.items.map((i) =>
            i.id === id
                ? {
                      ...i,
                      status: 'Review',
                      threads: [],
                      needsYou: {
                          reason: '',
                          causes: [],
                          ticketOpen: false,
                          startAgainPurpose: build ? 'build' : 'shape',
                          offers: ['start-again', 'back-to-list'],
                          ...needsYou,
                      },
                  }
                : i,
        ),
    };

    await mountPage(data);
    holdPosts(data);
    await openItem(id);
    await press(button('needs-you', id));

    return id;
}

test('shaping Start again confirms before posting and keeps the notice and the confirmation on failure', async () => {
    const id = await recoveryItem(false);

    expect(posted()).toEqual([]);
    await confirmPress('Start again');
    expect(posted()).toEqual([['/api/start-again', { itemId: id, options: {} }]]);
    await answer({ error: 'T3 is unavailable.' }, 502);
    expect(text($('#needs-you-dialog [data-slot="alert"]'))).toBe('T3 is unavailable.');
    expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
});

test('a no-thread notice starts again through its confirmation, and a started thread removes the notice', async () => {
    const id = await recoveryItem(false, {
        reason: 'T3 shows no thread.',
        causes: [{ type: 'no-thread' }],
        offers: ['start-again', 'set-aside'],
    });

    expect(text($('#needs-you-detail'))).toContain('This starts a new shaping thread in T3.');
    expect(posted()).toEqual([]);
    await confirmPress('Start again');
    expect(posted()).toEqual([['/api/start-again', { itemId: id, options: {} }]]);
    await answer({ error: 'T3 refused.' }, 502);
    expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
    await confirmPress('Try again');
    await answer({
        thread: { threadId: 't', title: 't' },
        error: null,
        board: { ...sample, items: sample.items.map((i) => (i.id === id ? { ...i, needsYou: undefined } : i)) },
    });
    expect(confirmation()).toBeNull();
    expect(inDialog('[data-needs-you-reason]')).toBeNull();
});

test('build recovery inspects before offering branches and explains a missing worktree', async () => {
    const id = await recoveryItem();

    expect(posted()).toEqual([['/api/inspect-recovery', { itemId: id }]]);
    expect(text(confirmation())).toContain('Checking the branch and PR...');
    await answer({ inspection: { branch: 'build/old', branchExists: true, worktreePath: null, pr: 'none' } });
    expect(text(confirmation())).toContain('The old worktree is gone.');
    expect(confirmButtons().map(text)).toEqual(['Cancel', 'Continue on old branch', 'Start on new branch']);
});

test('absent branch starts new once confirmed and receives the successful board', async () => {
    const id = await recoveryItem();

    await answer({ inspection: { branch: 'build/old', branchExists: false, worktreePath: null, pr: 'none' } });
    expect(posted(), 'nothing starts until the confirmation').toHaveLength(1);
    await confirmPress('Start again');
    expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
    await answer({ token: 'empty', plans: [] });
    expect(posted().at(-1)).toEqual(['/api/start-again', { itemId: id, options: { branchChoice: 'new' } }]);
    await answer({
        board: { ...sample, items: sample.items.map((i) => (i.id === id ? { ...i, needsYou: undefined } : i)) },
    });
    expect(inDialog('[data-needs-you-reason]')).toBeNull();
});

test('choosing a branch uses the model menu and sends recovery options', async () => {
    const id = await recoveryItem();

    await answer({ inspection: { branch: 'build/old', branchExists: true, worktreePath: null, pr: 'none' } });
    await pressMenu(confirmButtons().find((b) => text(b) === 'Start on new branch')!);
    await press($<HTMLElement>('[data-start-pick]')!);
    expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
    await answer({ token: 'empty', plans: [] });
    expect(posted().at(-1)).toEqual([
        '/api/start-again',
        { itemId: id, options: { branchChoice: 'new', confirmedOpenPr: false } },
    ]);
    await answer({ error: 'Start refused' }, 409);
    expect(text($('#needs-you-dialog [data-slot="alert"]'))).toBe('Start refused');
});

const CONCEPT = 'I_sample09';
const stats = (costUsd: number) => ({ agentMs: 60_000, tokens: 1000, costUsd });
const conceptBoard = (
    own: Item['stats'],
    part: Item['stats'],
    threads: Item['threads'] = [thread('part', 'done')],
): BoardData => ({
    ...sample,
    items: sample.items
        .map((i) =>
            i.id === CONCEPT
                ? { ...i, kind: 'concept' as const, stats: own }
                : i.parentId === CONCEPT
                  ? { ...i, stats: undefined, threads: i.id === 'I_sample10' ? threads : [] }
                  : i,
        )
        .map((i) => (i.id === 'I_sample10' ? { ...i, stats: part } : i)),
});

test('while T3 can’t be read, known figures stay and say they are last known', async () => {
    const data = {
        ...conceptBoard(stats(1), stats(2)),
        usageRead: { readable: false, readAt: '2026-11-03T10:00:00.000Z' },
    };

    await mountPage(data);
    await openItem(CONCEPT);

    const meta = text(inDialog('[data-meta]'));

    expect(text(inDialog('header'))).toContain('Direct work: Agent time 1m · 1K tokens · $1.00');
    expect(meta).toContain('With partsAgent time 2m · 2K tokens · $3.00');
    expect(meta).toContain('last known');
    expect(meta).not.toContain('Agent work unavailable.');
    expect(inDialog('[data-agent-work]')!.title).toMatch(
        /Last known figures from 3 Nov, \d\d:\d\d: T3 Code’s usage can’t be read now\./,
    );
});

const withoutFigures = (usageState: 'failed' | 'loading') => {
    const board = conceptBoard(undefined, undefined);

    return {
        ...board,
        items: board.items.map((i) =>
            i.id === CONCEPT
                ? { ...i, usageState, stats: { agentMs: 0, tokens: 0 }, threads: [thread('own', 'done')] }
                : i,
        ),
        usageRead: { readable: true },
    };
};

test('an item whose threads T3 hasn’t answered for yet says usage is loading, never that it has no thread', async () => {
    const data = withoutFigures('loading');

    await mountPage({
        ...data,
        items: data.items.map((item) => (item.id === CONCEPT ? { ...item, threads: 'unavailable' as const } : item)),
    });
    await openItem(CONCEPT);
    expect(text(inDialog('header'))).toContain('Loading agent work…');
    expect(text(inDialog('[data-meta]'))).not.toContain('No T3 thread');
});

describe('the working agents', () => {
    const at = new Date(NOW - 3_000).toISOString();
    const working: ItemThread = {
        id: 'build',
        title: 'Build',
        state: 'running',
        updated: at,
        activity: {
            available: true,
            readAt: at,
            action: 'Edit stage-row.tsx',
            actionAt: at,
            toolRunning: false,
            agents: [
                {
                    title: 'Review',
                    model: 'Opus 5.5',
                    action: 'pnpm test',
                    actionAt: new Date(NOW - 60_000).toISOString(),
                },
                { title: 'Subagent' },
            ],
        },
    };
    const board = (change: Partial<Item>, data: BoardData = sample): BoardData => ({
        ...fresh(data),
        items: data.items.map((i) =>
            i.id === 'I_sample13' ? { ...i, status: 'In progress', threads: [working], ...change } : i,
        ),
    });
    const section = () => inDialog('[data-working-agents]');

    test('details shows no list for a paused or archived item, or with no thread at work', async () => {
        const stopped: ItemThread = { id: 'build', title: 'Build', state: 'stopped', updated: at };

        for (const change of [
            { paused: 'Paused' },
            { archived: true },
            { threads: [] },
            { threads: [{ ...stopped, state: 'done' as const }] },
            { threads: [stopped] },
        ] as Partial<Item>[]) {
            await mountPage(board(change));
            await openItem('I_sample13');
            expect(section()).toBeNull();
        }
    });

    test('details follows a read going old with no new data', async () => {
        const { ACTIVITY_STALE_MS } = await import('@lar-factory/shared');

        await mountPage(board({ threads: [working] }));
        await openItem('I_sample13');
        expect(section()!.querySelector('li')).not.toBeNull();
        // The system time alone moves, as the page's poll would bring the sample back.
        vi.setSystemTime(NOW + ACTIVITY_STALE_MS);
        await settle(() => vi.advanceTimersByTime(1_000));
        expect(text(section())).toContain('Activity unavailable');
        expect(text(section())).toContain('Check that T3 is connected');
        expect(section()!.querySelector('li')).toBeNull();
    });
});

test.each(['task', 'research', 'prototype', 'grill', null] as const)(
    'a decision with method %s shows its own steps and names the work its Start begins',
    async (method) => {
        const base = sample.items.find((item) => item.id === 'I_sample4') ?? sample.items[0]!;
        const decision: Item = {
            ...base,
            id: 'decision',
            kind: 'decision',
            decisionMethod: method,
            status: 'Queued',
            statuses: ['Queued'],
            slices: [],
            blockers: [],
            threads: [],
            linkedPrs: [],
            completion: undefined,
            kindDisagreement: undefined,
        };

        await mountPage({ ...sample, items: [decision] });
        await openItem(decision.id);
        expect(text(inDialog('[data-step-names]'))).toBe('QueueWorkingOutcome');
        expect(text(inDialog('[data-steps]'))).toContain('Stage 1 of 3');
        expect(text(button('start', decision.id))).toContain(`Start ${method ?? 'decision'}`);
        await push(moved(decision.id, 'Shaping', { ...sample, items: [decision] }));
        expect(text(inDialog('[data-steps]'))).toContain('Stage 2 of 3');
        expect(text(inDialog('[data-item-summary]'))).toContain('Working');
        await push(moved(decision.id, 'Done', { ...sample, items: [decision] }));
        expect(text(inDialog('[data-steps]'))).toContain('Stage 3 of 3');
        expect(text(inDialog('[data-item-summary]'))).toContain('Complete');
    },
);

test('acceptance evidence retains full unbroken paths and hashes alongside the closed-ticket callout', async () => {
    const evidence = `/proof/${'artifact'.repeat(48)}/assertions.txt SHA256: ${'a'.repeat(64)}`;

    await mountPage(withDependency(dependencyBlocker('closed', { evidence })));
    await openItem('I_sample13');
    expect(text(dependencyRow().querySelector('[data-dependency-evidence]'))).toBe(`Evidence: ${evidence}`);
    expect(text(dependencyRow().querySelector('[data-dependency-notice]'))).toContain('once the change is delivered');
    expect(dependencyRow().querySelector('button')).not.toBeNull();
});
