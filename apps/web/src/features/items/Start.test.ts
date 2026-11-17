// Shape on a Queued item, in the item dialog: its menu of model choices, and what a start shows in the dialog and in
// a toast. Ported from the Start cases of test/render.test.ts.

import type { BoardData, ModelGroup } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    answer,
    holdPosts,
    mountPage,
    posted,
    pressMenu,
    push,
    sample,
    settle,
    text,
    toast,
} from '@/test/PageTest';

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
const modelMenu = (id = 'I_sample05') => $<HTMLButtonElement>(`[data-item-dialog] [data-start-model="${id}"]`)!;
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
    modelMenu(id).focus();
    await pressMenu(modelMenu(id));
};

beforeEach(() => {
    localStorage.clear();
    holdPosts(withChoices);
});

test.each([
    { verb: 'Shape', remembered: { instanceId: 'codex', model: 'gpt-5.5' } },
    { verb: 'Decide', remembered: { instanceId: 'removed', model: 'old-model' } },
])(
    '$verb starts immediately with the remembered model or project default, and only submits once',
    async ({ verb, remembered }) => {
        localStorage.setItem(CHOICE_KEY, JSON.stringify(remembered ?? null));

        const data: BoardData = {
            ...withChoices,
            items: withChoices.items.map((item) =>
                item.id === 'I_sample05'
                    ? {
                          ...item,
                          status: verb === 'Build' ? 'Ready' : 'Queued',
                          kind: verb === 'Decide' ? 'decision' : item.kind,
                          passingBrief: verb === 'Build',
                          threads: [],
                      }
                    : item,
            ),
        };

        holdPosts(data);
        await mountItem(data);
        expect(text(start())).toBe(verb);
        start().focus();
        await settle(() => {
            start().click();
            start().click();
        });
        expect(menu()).toBeNull();
        expect(posted()).toEqual([
            [
                verb === 'Build' ? '/api/start-build' : '/api/start',
                { session: 's1', itemId: 'I_sample05', ...(verb === 'Shape' ? { model: remembered } : {}) },
            ],
        ]);
        expect(document.activeElement).toBe(start());
        expect(modelMenu().getAttribute('aria-disabled')).toBe('true');
        await pressMenu(modelMenu());
        expect(menu()).toBeNull();
    },
);

test('sample mode holds the main action and leaves model choices viewable without starting', async () => {
    await mountItem({ ...withChoices, capture: { session: 's1', enabled: false } });
    expect(start().disabled).toBe(true);
    await press(start());
    await open();
    expect(entries().length).toBe(4);
    await press(entries()[1]!);
    expect(posted()).toEqual([]);
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
    await pressMenu(modelMenu());
    expect(menu(), 'no menu while a start is in flight').toBeNull();
    await press(start());
    expect(posted(), 'the main action cannot submit again while pending').toHaveLength(1);

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

test.each(['main', 'override'])(
    'Ready at capacity: %s uses Start after unless explicitly starting now',
    async (route) => {
        const choice = { instanceId: 'codex', model: 'gpt-5.5' };

        localStorage.setItem(CHOICE_KEY, JSON.stringify(choice));

        const data = {
            ...withChoices,
            autoBuild: { on: false },
            buildLimit: { limit: 1, automatic: 1 },
            items: withChoices.items.map((item) =>
                item.id === 'I_sample13'
                    ? {
                          ...item,
                          status: 'Ready' as const,
                          passingBrief: true,
                          parentId: null,
                          blockers: [],
                          threads: [],
                      }
                    : item.id === 'I_sample14'
                      ? { ...item, buildReserved: true }
                      : item,
            ),
        };

        holdPosts(data);
        await mountItem(data, 'I_sample13');
        expect(start('I_sample13').disabled).toBe(false);
        expect(text(card())).toContain('Start after a slot frees.');

        if (route === 'main') {
            start('I_sample13').focus();
            await settle(() => {
                start('I_sample13').click();
                start('I_sample13').click();
            });
        } else {
            await open('I_sample13');

            if (route === 'model') await press(entries()[1]!);
            else await press($$('[role="menuitem"]').find((el) => text(el) === 'Start now (over the limit)')!);
        }

        expect(menu()).toBeNull();
        expect(posted()).toEqual([
            [
                route === 'override' ? '/api/start-build' : '/api/arm',
                { session: 's1', itemId: 'I_sample13', model: choice },
            ],
        ]);
        expect(modelMenu('I_sample13').getAttribute('aria-disabled')).toBe('true');

        if (route === 'override') return;

        await answer({ error: null, board: { ...data, armed: { I_sample13: { model: choice } } } });

        const armed = () => card().querySelector<HTMLButtonElement>('[data-start-after="I_sample13"]')!;

        expect(text(armed())).toContain('Starts after a slot frees');
        expect(armed().getAttribute('aria-pressed')).toBe('true');
        expect(document.activeElement).toBe(armed());

        // A freed slot keeps the armed control until the server launches, including across board refreshes.
        await push({ ...data, buildLimit: { limit: 100, automatic: 1 }, armed: { I_sample13: { model: choice } } });
        await press(armed());
        expect(posted()[1]).toEqual(['/api/disarm', { session: 's1', itemId: 'I_sample13' }]);
    },
);

test('restarting a stopped build whose PR is open at capacity does not warn about the limit', async () => {
    const openPr = withChoices.items.find((item) => item.id === 'I_sample14')!.linkedPrs;
    const data = {
        ...withChoices,
        buildLimit: { limit: 1, automatic: 1 },
        items: withChoices.items.map((item) =>
            item.id === 'I_sample13'
                ? {
                      ...item,
                      status: 'In progress' as const,
                      parentId: null,
                      blockers: [],
                      linkedPrs: openPr,
                      slices: [],
                      buildReserved: false,
                      threads: [
                          {
                              id: 'stopped-build',
                              title: 'Build',
                              purpose: 'build' as const,
                              state: 'stopped' as const,
                              updated: '2026-10-21T09:00:00.000Z',
                          },
                      ],
                  }
                : item.id === 'I_sample22'
                  ? { ...item, buildReserved: true }
                  : item,
        ),
    };

    await mountItem(data, 'I_sample13');
    expect(text(start('I_sample13'))).toBe('Retry start');
    expect(text(card())).not.toContain('over the limit');
});
