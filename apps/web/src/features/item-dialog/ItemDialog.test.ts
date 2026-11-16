// The item dialog: opened through its store, it leads its main column with what waits on you (a pull request's or a
// question's notice carries its action), then progress, the work and the ticket; its sidebar lists the item's status,
// project with its ticket link, kind and agent work figures, then sub-tickets and pull requests; and its footer carries
// the action the item's status asks for when the notice doesn't.

import type { Blocker, BoardData, DependencyHold, Item } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    answer,
    holdPosts,
    mountPage,
    moved,
    posted,
    pressMenu,
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

/** The sample with `itemId`'s threads replaced. */
const withThreads = (itemId: string, threads: Item['threads'], data: BoardData = sample): BoardData => ({
    ...data,
    items: data.items.map((i) => (i.id === itemId ? { ...i, threads } : i)),
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
    expect(footerControls()).toEqual(['Open thread', 'Build']);
    await pressMenu(button('start', 'I_sample13'));
    await settle(() => vi.advanceTimersByTime(20));
    await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
    expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13' }]]);

    const thread = { threadId: 'thread-1', title: 'Build maddec01/lar-server#140' };

    await answer({ thread, error: null, board: { ...readyBuild, startedBuilds: { I_sample13: thread } } });
    expect(text(inDialog('[data-start-result="I_sample13"]'))).toBe('Started');
});

test('Move to the List in the dialog shows the item in the list, says so, and moves focus to Queue', async () => {
    holdPosts();
    await mountPage();
    await openItem('I_sample05');
    await press(button('back-to-list', 'I_sample05'));
    expect(text(button('back-to-list', 'I_sample05'))).toBe('Moving to the List…');
    expect(posted()).toEqual([['/api/back-to-list', { itemId: 'I_sample05' }]]);
    await answer({ error: null, board: moved('I_sample05', 'List') });
    expect(text(toast())).toMatch(/^Moved #129 .* to the List\. View item$/);
    expect(document.activeElement).toBe(button('queue', 'I_sample05'));
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

const abandonButtons = () => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button');
const abandonPress = (name: string) => press(abandonButtons().find((b) => text(b) === name)!);
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
    // What holds it, in short, as its row says it; in full on its tooltip.
    expect(text(inDialog('[data-item-summary] > div'))).toBe('StatusWaits on server team');
    expect(inDialog('[data-item-summary] > div [title*="Dependency on server team"]')).not.toBeNull();
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
        'EvidenceThe endpoint answers in staging',
    );
    expect(text(dependencyRow().querySelector('[data-dependency-notice]'))).toBe(
        'Its ticket maddec01/lar-server#40 is closed. Mark it met once the change is delivered.',
    );
    expect(footerControls()).toEqual(['Open thread', 'Start when unblocked']);
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
