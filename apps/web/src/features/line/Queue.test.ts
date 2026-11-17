// The Queue rail: Shape with its model menu starts its row's item and shows the start on the row.

import type { BoardData, ModelGroup } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { $, $$, answer, holdPosts, mountPage, posted, pressMenu, sample, settle, text, toast } from '@/test/PageTest';

const MODEL_CHOICES: ModelGroup[] = [
    { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
    { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
];
const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: MODEL_CHOICES };
const CHOICE_KEY = 'lar-board:model-choice';

const row = (id: string) => $<HTMLLIElement>(`[data-stage="queue"] li[data-item="${id}"]`)!;
const start = (id: string) => row(id).querySelector<HTMLButtonElement>(`[data-start="${id}"]`)!;
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
const press = async (el: HTMLElement) => {
    el.focus();
    await settle(() => {
        el.click();
        vi.advanceTimersByTime(0);
    });
};

beforeEach(() => localStorage.clear());

test('Shape’s chevron opens its menu without opening the dialog, and starts its row’s item with the picked model', async () => {
    holdPosts(withChoices);
    await mountPage(withChoices);
    await pressMenu(row('I_sample06').querySelector('[data-start-model]')!);
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
