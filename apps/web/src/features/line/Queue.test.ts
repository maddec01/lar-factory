// The Queue rail: Queued items as numbered rows that open the item dialog, Shape with its model menu, and what
// a start shows on the row. Ported from the Queued cases of the old Board view's tests.

import type { BoardData, Item, ModelGroup } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    answer,
    holdPosts,
    moved,
    mountPage,
    posted,
    pressMenu,
    sample,
    settle,
    text,
    toast,
} from '@/test/PageTest';

const MODEL_CHOICES: ModelGroup[] = [
    { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
    { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
];
const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: MODEL_CHOICES };
const CHOICE_KEY = 'lar-board:model-choice';

const rows = () => $$<HTMLLIElement>('[data-stage="queue"] ol > li');
const row = (id: string) => $<HTMLLIElement>(`[data-stage="queue"] li[data-item="${id}"]`)!;
const start = (id = 'I_sample05') => row(id).querySelector<HTMLButtonElement>(`[data-start="${id}"]`)!;
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
const press = async (el: HTMLElement) => {
    el.focus();
    await settle(() => {
        el.click();
        vi.advanceTimersByTime(0);
    });
};
const sample05 = sample.items.find((i) => i.id === 'I_sample05')!;
/** A Queued decision under `parent`, a sample item's number. */
const decision = (id: string, parent: number): Item => ({
    ...sample05,
    id,
    number: 300 + parent,
    title: `Decide under #${parent}`,
    labels: ['decision-grill'],
    parent: { number: parent, repo: sample05.repo!, title: 'Parent', url: 'https://github.com/x', state: 'open' },
    flow: 'linked',
    parentId: sample.items.find((i) => i.number === parent)?.id ?? null,
});

beforeEach(() => localStorage.clear());

test('a dossier’s parts are left out and show in the dossier; a Queued parent stays in its dossier, including a part whose parent is off-board', async () => {
    for (const id of ['I_sample05', 'I_sample09']) localStorage.setItem(`lar-board:dossier-view:${id}`, 'list');
    await mountPage({
        ...sample,
        items: [
            ...sample.items.map((item) => (item.id === 'I_sample05' ? { ...item, flow: 'linked' as const } : item)),
            decision('I_d200', 200),
            decision('I_d129', 129),
            decision('I_d999', 999),
        ],
    });
    expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample06', 'I_sample21']);

    const openDossier = (id: string) =>
        settle(() => $<HTMLButtonElement>(`[data-dossier="${id}"] [data-dossier-open]`)!.click());

    expect($('[data-dossier="I_d999"]')).not.toBeNull();
    await openDossier('I_sample05');
    expect($('[data-dossier="I_sample05"] [data-part="I_d129"]'), '#129’s sub-issue, in its dossier').not.toBeNull();
    await openDossier('I_sample09');
    expect(
        $('[data-dossier="I_sample09"] [data-part="I_d200"]'),
        'concept #200’s decision, in its dossier',
    ).not.toBeNull();
});

test('a Queued item blocked by an open issue shows only Start after', async () => {
    const blocked = {
        ...withChoices,
        items: sample.items.map((i) =>
            i.id === 'I_sample05'
                ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' as const }] }
                : i,
        ),
    };

    await mountPage(blocked);
    expect(row('I_sample05').querySelector('[data-start]'), 'no disabled Start beside it').toBeNull();

    const after = row('I_sample05').querySelector<HTMLElement>('[data-start-after]')!;

    expect([text(after), after.dataset.kind, Boolean(after.querySelector('[data-slot="icon"] svg'))]).toEqual([
        'Start after #202',
        'open',
        true,
    ]);
    expect(text(row('I_sample05').querySelector('[data-blocked]'))).toBe('Blocked by #202 until it completes');
});

test('Shape opens its menu without opening the dialog, and starts its row’s item with the picked model', async () => {
    holdPosts(withChoices);
    await mountPage(withChoices);
    await pressMenu(start('I_sample06'));
    expect(entries().map(text)).toEqual(['Project default in T3', 'GPT-5.5', 'Opus 5.5']);
    await press(entries()[2]!);
    expect(dialog(), 'neither the button nor the menu opens the dialog').toBeNull();
    expect(posted()).toEqual([
        [
            '/api/start',
            { session: 's1', itemId: 'I_sample06', model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' } },
        ],
    ]);
    expect([text(start('I_sample06')), start('I_sample06').getAttribute('aria-disabled')]).toEqual([
        'Starting…',
        'true',
    ]);

    const title = `#20 ${sample.items.find((i) => i.id === 'I_sample06')!.title}`;
    const thread = { threadId: 'thread-1', title };

    await answer({ thread, error: null, board: { ...withChoices, started: { I_sample06: thread } } });

    const tag = row('I_sample06').querySelector('[data-start-result]')!;

    expect([text(tag), tag.getAttribute('title')]).toEqual(['Started', 'T3 thread thread-1']);
    expect(row('I_sample06').querySelector('[data-start]')).toBeNull();
    expect(text(toast())).toBe('Refining started for #20. Open thread');
    expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!)).toEqual({
        instanceId: 'claudeAgent',
        model: 'claude-opus-5-5',
    });
});

test('while an item has a running or needs-you thread, its row has Open thread in place of Shape', async () => {
    const threads = (state: string) => [{ id: 't1', title: 'x', state }];
    const items = sample.items.map((i) =>
        i.id === 'I_sample05'
            ? { ...i, threads: threads('running') }
            : i.id === 'I_sample06'
              ? { ...i, threads: threads('needs you') }
              : i,
    ) as Item[];

    await mountPage({ ...sample, items, t3EnvironmentId: 'env-1' });
    expect(row('I_sample05').querySelector('[data-start]')).toBeNull();

    const open = row('I_sample05').querySelector<HTMLAnchorElement>('[data-open-thread]')!;

    expect([open.getAttribute('aria-label'), open.getAttribute('href')]).toEqual([
        'Open thread',
        expect.stringContaining('t1'),
    ]);
    expect(row('I_sample06').querySelector('[data-open-thread]')).not.toBeNull();
});

test('a failed Start shows on its row with Retry start; closing the error doesn’t open the dialog', async () => {
    holdPosts(withChoices);
    await mountPage(withChoices);
    await pressMenu(start());
    await press(entries()[0]!);
    await answer({ thread: null, error: 'T3 is down.' }, 502);
    expect(text(start())).toBe('Retry start');
    expect(text(row('I_sample05').querySelector('.start [role="alert"]'))).toBe('T3 is down.');
    await press(row('I_sample05').querySelector<HTMLButtonElement>('.start button.dismiss')!);
    expect(row('I_sample05').querySelector('.start')).toBeNull();
    expect(dialog()).toBeNull();
    expect(text(start())).toBe('Shape');
});

test('a Start that may have run hides Shape; closing its message leaves a tag', async () => {
    holdPosts(withChoices);
    await mountPage(withChoices);
    await pressMenu(start());
    await press(entries()[0]!);
    await answer({
        thread: null,
        uncertain: true,
        error: 'Check T3.',
        board: {
            ...withChoices,
            startProgress: { I_sample05: { shape: { phase: 'may-have-started', message: 'Check T3.' } } },
        },
    });

    const moved = () => $<HTMLLIElement>('[data-stage="shaping"] li[data-item="I_sample05"]')!;

    expect(
        [$('[data-stage="queue"] li[data-item="I_sample05"]'), moved().querySelector('[data-start]')],
        'a start in flight moves the row to Shaping',
    ).toEqual([null, null]);

    const message = moved().querySelector<HTMLElement>('.start[data-start-result]')!;

    expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
    await settle(() => message.querySelector<HTMLButtonElement>('button.dismiss')!.click());
    expect(text(moved().querySelector('.started-tag.unsure'))).toBe('May have started');
});

test('Move to List from the dialog takes the item off the Queue', async () => {
    holdPosts();
    await mountPage();
    await settle(() => row('I_sample05').querySelector<HTMLButtonElement>('[data-row-open]')!.click());
    await press(dialog()!.querySelector<HTMLButtonElement>('[data-back-to-list="I_sample05"]')!);
    expect(posted()).toEqual([['/api/back-to-list', { itemId: 'I_sample05' }]]);
    await answer({ error: null, board: moved('I_sample05', 'List') });
    expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample06', 'I_sample21']);
    expect(text(toast())).toMatch(/^Moved #129 .* to List\. View item$/);
});
