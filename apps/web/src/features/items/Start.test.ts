// Shape on a Queued item, in the item dialog: its menu of model choices, and what a start shows in the dialog and in
// a toast. Ported from the Start cases of test/render.test.ts.

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
/** The dialog's Move to the List and Abandon. */
const footer = () => card().querySelector('[data-back-to-list], [data-abandon]');
const menu = () => $('[role="menu"]');
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const checked = () =>
    entries()
        .filter((e) => e.getAttribute('aria-checked') === 'true')
        .map(text);
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
    expect(footer(), 'no Move to the List or Abandon while Start is pending').toBeNull();
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

test('a Start that may have run hides Start, Move to the List and Abandon; closing its message leaves a tag', async () => {
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
