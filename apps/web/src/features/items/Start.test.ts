// Shape on a Queued item, in the item dialog: its menu of model choices, how keys and clicks move through it,
// and what a start shows in the dialog and in a toast. Ported from the Start cases of test/render.test.ts.

import type { BoardData, ModelGroup } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { $, $$, answer, holdPosts, mountPage, posted, pressMenu, sample, settle, text, toast } from '@/test/PageTest';

const MODEL_CHOICES: ModelGroup[] = [
    { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
    {
        instanceId: 'claudeAgent',
        name: 'VI <work>',
        models: [
            { slug: 'claude-opus-5-5', label: 'Opus 5.5' },
            { slug: 'claude-opus-5-5[1m]', label: 'claude-opus-5-5[1m]' },
        ],
    },
];
const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: MODEL_CHOICES };
const CHOICE_KEY = 'lar-board:model-choice';

const start = (id = 'I_sample05') => $<HTMLButtonElement>(`[data-item-dialog] [data-start="${id}"]`)!;
const card = () => $('[data-item-dialog]')!;
/** The dialog's Move to List and Abandon. */
const footer = () => card().querySelector('[data-back-to-list], [data-abandon]');
const menu = () => $('[role="menu"]');
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const checked = () =>
    entries()
        .filter((e) => e.getAttribute('aria-checked') === 'true')
        .map(text);
const key = async (el: Element, k: string) => {
    await settle(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
    // Radix moves focus on the next tick.
    await settle(() => vi.advanceTimersByTime(20));
};
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) =>
    settle(() => {
        (el as HTMLElement).click();
        vi.advanceTimersByTime(0);
    });

/** Opens the item dialog on `id` through its store, as every list on the page does. */
async function openItem(id: string): Promise<void> {
    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(id));
}

/** Mounts the page with `data` and opens the dialog on the Queued #129. */
async function mountItem(data?: BoardData, id = 'I_sample05'): Promise<void> {
    await mountPage(data);
    await openItem(id);
}

const open = async (id = 'I_sample05') => {
    start(id).focus();
    await pressMenu(start(id));
};

beforeEach(() => {
    localStorage.clear();
    holdPosts(withChoices);
});

test('the menu highlights the remembered model choice while it is offered, else "Project default in T3"', async () => {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ instanceId: 'claudeAgent', model: 'claude-opus-5-5[1m]' }));
    await mountItem(withChoices);
    await open();
    expect(checked()).toEqual(['claude-opus-5-5[1m]']);
    expect(document.activeElement).toBe(entries()[3]);
});

test('arrow keys, Home and End move through the entries and wrap', async () => {
    await mountItem(withChoices);
    await open();

    const at = () => entries().indexOf(document.activeElement as HTMLElement);

    await key(document.activeElement!, 'ArrowUp');
    expect(at(), 'up from the first wraps to the last').toBe(3);
    await key(document.activeElement!, 'ArrowDown');
    expect(at(), 'down from the last wraps to the first').toBe(0);
    await key(document.activeElement!, 'ArrowDown');
    expect(at()).toBe(1);
    await key(document.activeElement!, 'End');
    expect(at()).toBe(3);
    await key(document.activeElement!, 'Home');
    expect(at()).toBe(0);
});

test('Escape closes the menu and returns focus to Start', async () => {
    await mountItem(withChoices);
    await open();
    await key(document.activeElement!, 'Escape');
    expect(menu()).toBeNull();
    expect(start().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(start());
});

test('picking an entry starts the item with that model, shows the thread, and remembers the choice', async () => {
    await mountItem(withChoices);
    await open();
    await press(entries()[2]!);
    expect(posted()).toEqual([
        [
            '/api/start',
            { session: 's1', itemId: 'I_sample05', model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' } },
        ],
    ]);
    expect(menu()).toBeNull();
    expect([text(start()), start().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);
    expect(start().getAttribute('aria-busy')).toBe('true');
    expect(start().querySelector('.animate-spin > svg')).not.toBeNull();
    expect(
        [...start().querySelector('[data-slot="icon"] > .animate-spin')!.classList],
        'a block box, not a text line that sits it high and grows the icon box',
    ).toEqual(expect.arrayContaining(['flex', 'w-fit']));
    expect(document.activeElement, 'focus is back on Start').toBe(start());
    expect(footer(), 'no Move to List or Abandon while Start is pending').toBeNull();
    await pressMenu(start());
    expect(menu(), 'no menu while a start is in flight').toBeNull();

    const thread = { threadId: 'thread-1', title: '#129 Run more than one 4K HDR to 1080p stream at a time' };

    await answer({ thread, error: null, board: { ...withChoices, started: { I_sample05: thread } } });

    const tag = card().querySelector('[data-start-result]')!;

    expect([
        tag.classList.contains('started-tag'),
        tag.querySelector('[data-status-dot]')?.getAttribute('data-status-dot'),
        tag.className.includes('bg-success-surface'),
        text(tag),
        tag.getAttribute('title'),
    ]).toEqual([true, 'success', false, 'Started', 'T3 thread thread-1']);
    expect(card().querySelector('[data-start]'), 'the dialog keeps only a quiet tag').toBeNull();
    expect(footer()).toBeNull();
    expect(document.activeElement, 'focus moves to the tag').toBe(tag);
    expect(text(toast()), 'the toast doesn’t repeat a title that is the work message title').toBe(
        'Refining started for #129. Open thread',
    );
    expect(toast()!.querySelector('code')).toBeNull();
    expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!)).toEqual({
        instanceId: 'claudeAgent',
        model: 'claude-opus-5-5',
    });
    await openItem('I_sample06');
    await open('I_sample06');
    expect(checked(), 'the next menu highlights it').toEqual(['Opus 5.5']);
});

test('a failed Start shows in the dialog, keeps Move to List and the last choice, and offers Retry start', async () => {
    localStorage.setItem(CHOICE_KEY, JSON.stringify({ instanceId: 'codex', model: 'gpt-5.5' }));
    await mountItem(withChoices);
    await open();
    await press(entries()[2]!);
    await answer({ thread: null, error: 'T3 is down.' }, 502);
    expect(text(start())).toBe('Retry start');
    expect(text(card().querySelector('.start [role="alert"]'))).toBe('T3 is down.');
    expect(footer(), 'a failed Start brings Move to List and Abandon back').not.toBeNull();
    expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!), 'a failure keeps the previous choice').toEqual({
        instanceId: 'codex',
        model: 'gpt-5.5',
    });

    const close = card().querySelector<HTMLButtonElement>('.start button.dismiss')!;

    expect(close.getAttribute('aria-label')).toBe('Dismiss error for #129');
    close.focus();
    await settle(() => close.click());
    expect(card().querySelector('.start')).toBeNull();
    expect(text(start())).toBe('Shape');
    expect(document.activeElement).toBe(card().querySelector('[data-back-to-list]'));
});

test('a Start that may have run hides Start, Move to List and Abandon; closing its message leaves a tag', async () => {
    await mountItem(withChoices);
    await open();
    await press(entries()[1]!);
    await answer({
        thread: null,
        uncertain: true,
        error: 'Check T3.',
        board: {
            ...withChoices,
            startProgress: { I_sample05: { shape: { phase: 'may-have-started', message: 'Check T3.' } } },
        },
    });
    expect(card().querySelector('[data-start]')).toBeNull();
    expect(footer()).toBeNull();

    const message = card().querySelector<HTMLElement>('.start[data-start-result]')!;

    expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
    expect(document.activeElement, 'focus moves to the message').toBe(message);
    expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!), 'it may have started, so the choice is kept').toEqual({
        instanceId: 'codex',
        model: 'gpt-5.5',
    });
    await settle(() => message.querySelector<HTMLButtonElement>('button.dismiss')!.click());

    const tag = card().querySelector('.started-tag.unsure')!;

    expect([
        tag.querySelector('[data-status-dot]')?.getAttribute('data-status-dot'),
        tag.className.includes('bg-warning-surface'),
        text(tag),
        tag.getAttribute('title'),
    ]).toEqual(['warning', false, 'May have started', 'Check T3 before starting it again']);
    expect(card().querySelector('[data-start]')).toBeNull();
    expect(footer()).toBeNull();
});

test('the server shows Starting in a page that never pressed it, and after a reload', async () => {
    await mountItem({ ...withChoices, startProgress: { I_sample05: { shape: { phase: 'starting' } } } });
    expect([text(start()), start().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);
    expect(footer(), 'a running start holds Move to List and Abandon').toBeNull();
});

test('a failed start from the server offers Retry start, and closing it clears it on the server', async () => {
    const failed = {
        ...withChoices,
        startProgress: { I_sample05: { shape: { phase: 'failed' as const, message: 'T3 said no' } } },
    };

    await mountItem(failed);
    expect(text(start())).toBe('Retry start');
    expect(text(card().querySelector('.start [role="alert"]'))).toBe('T3 said no');
    expect(footer(), 'a failed start gives Move to List back').not.toBeNull();
    await press(card().querySelector('.start button.dismiss')!);
    expect(posted()).toEqual([['/api/dismiss-start-error', { session: 's1', itemId: 'I_sample05', purpose: 'shape' }]]);
    await answer({ error: null, board: withChoices });
    expect(card().querySelector('.start')).toBeNull();
    expect(text(start())).toBe('Shape');
});

test('a refusal the board holds no state for, as from a restarted server, keeps its error here', async () => {
    await mountItem(withChoices);
    await open();
    await press(entries()[0]!);
    await answer({ error: 'The board restarted. Press Start again.', board: withChoices }, 409);
    expect(text(start())).toBe('Retry start');
    expect(text(card().querySelector('.start [role="alert"]'))).toBe('The board restarted. Press Start again.');
});

test('Started clears after its server record disappears', async () => {
    await mountItem(withChoices, 'I_sample05');
    await press(start());

    const thread = { threadId: 'thread-1', title: 'Refine' };

    await answer({ thread, error: null });

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive({ ...withChoices, started: { I_sample05: thread } }));
    await settle(() => useBoardStore.getState().receive({ ...withChoices, started: {} }));
    expect(card().querySelector('.started-tag')).toBeNull();
    expect(start()).toBeTruthy();
});

test('a held Shape explains why visibly and becomes available when project discovery recovers', async () => {
    const item = withChoices.items.find((item) => item.id === 'I_sample05')!;
    const reason = "Can't read T3 Code's projects; the board retries automatically";

    await mountItem({ ...withChoices, repositoryProjects: { [item.repo!]: reason } });
    expect(start().disabled).toBe(true);
    expect(text(document.getElementById(start().getAttribute('aria-describedby')!))).toBe(reason);

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.setState({ data: { ...withChoices, repositoryProjects: { [item.repo!]: null } } }),
    );
    expect(start().disabled).toBe(false);
    expect(text(card())).not.toContain(reason);
});

for (const state of ['done', 'stopped'] as const)
    test(`an ended shaping owner offers Resume shaping after ${state}, including a saved board start`, async () => {
        const id = 'I_sample05';
        const owner = { threadId: 'previous-shape', title: 'Previous shape' };
        const data: BoardData = {
            ...withChoices,
            started: { [id]: owner },
            items: withChoices.items.map((item) =>
                item.id === id
                    ? {
                          ...item,
                          status: 'Shaping',
                          threads: [
                              {
                                  id: owner.threadId,
                                  title: owner.title,
                                  state,
                                  purpose: 'shape',
                                  updated: '2026-11-13T10:00:00Z',
                              },
                          ],
                      }
                    : item,
            ),
        };

        await mountItem(data);
        expect(start()?.textContent).toBe('Resume');
        expect(card().querySelector('[data-start-result]')).toBeNull();
    });

test('Ready offers manual Start build at capacity and warns that it will go over the limit', async () => {
    const data = {
        ...withChoices,
        buildLimit: { limit: 1, automatic: 1 },
        items: withChoices.items.map((item) =>
            item.id === 'I_sample13'
                ? { ...item, status: 'Ready' as const, passingBrief: true, parentId: null, blockers: [], threads: [] }
                : item.id === 'I_sample14'
                  ? { ...item, buildReserved: true }
                  : item,
        ),
    };

    await mountItem(data, 'I_sample13');
    expect(start('I_sample13').disabled).toBe(false);
    expect(text(card())).toContain('Starting now will go over the limit.');
    await open('I_sample13');
    await press(entries()[0]!);
    expect(posted()[0]?.[0]).toBe('/api/start-build');
});

test('an unrecorded List PR leaves the build count at zero and the Ready row without a capacity warning', async () => {
    const ready = {
        ...withChoices.items.find((item) => item.id === 'I_sample13')!,
        status: 'Ready' as const,
        passingBrief: true,
        parentId: null,
        blockers: [],
        threads: [],
        buildStarted: undefined,
        buildPhase: undefined,
        linkedPrs: [],
    };
    const external = {
        ...ready,
        id: 'external',
        status: 'List' as const,
        statuses: [],
        recorded: false,
        linkedPrs: [
            {
                number: 4,
                url: 'https://example.test/pr/4',
                state: 'open' as const,
                isDraft: false,
                checks: null,
                mergeState: 'can merge' as const,
            },
        ],
    };

    await mountItem({ ...withChoices, buildLimit: { limit: 1, automatic: 1 }, items: [ready, external] }, ready.id);

    // A quiet board leaves the building count out of the title bar rather than counting zero.
    expect($$('[data-slot="toolbar-counter"]').some((node) => text(node).startsWith('building:'))).toBe(false);
    expect(text(document.body)).toContain('0 building · limit 1');
    expect(text(card())).not.toContain('Starting now will go over the limit.');
    expect(text(document.body)).not.toContain('Waiting for a build slot');
    expect(start(ready.id).disabled).toBe(false);
});
