// Start refining on a Queued item, in the item dialog: its menu of model choices, how keys and clicks move through it,
// and what a start shows in the dialog and in a toast. Ported from the Start cases of test/render.test.ts.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, answer, holdPosts, mountPage, posted, sample, settle, text, toast } from '../../test/support.ts';
import type { BoardData, ModelGroup } from '@lar-factory/shared';

const MODEL_CHOICES: ModelGroup[] = [
  { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
  { instanceId: 'claudeAgent', name: 'VI <work>', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }, { slug: 'claude-opus-5-5[1m]', label: 'claude-opus-5-5[1m]' }] },
];
const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: MODEL_CHOICES };
const CHOICE_KEY = 'lar-board:model-choice';

const start = (id = 'I_sample05') => $<HTMLButtonElement>(`[data-item-dialog] [data-start="${id}"]`)!;
const card = () => $('[data-item-dialog]')!;
/** The dialog's Back to List and Abandon. */
const footer = () => card().querySelector('[data-back-to-list], [data-abandon]');
const menu = () => $('[role="menu"]');
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const checked = () => entries().filter((e) => e.getAttribute('aria-checked') === 'true').map(text);
const key = async (el: Element, k: string) => {
  await settle(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })));
  // Base UI moves focus in the next frame.
  await settle(() => vi.advanceTimersByTime(20));
};
const press = (el: Element) => settle(() => (el as HTMLElement).click());
/** A press outside the menu, which closes it before the click lands. */
const pressOutside = (el: Element) => settle(() => {
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
});
/** Opens the item dialog on `id` through its store, as every list on the page does. */
async function openItem(id: string): Promise<void> {
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(id));
}
/** Mounts the page with `data` and opens the dialog on the Queued #129. */
async function mountItem(data?: BoardData, id = 'I_sample05'): Promise<void> {
  await mountPage(data);
  await openItem(id);
}
const open = async (id = 'I_sample05') => {
  start(id).focus();
  await press(start(id));
};

beforeEach(() => {
  localStorage.clear();
  holdPosts(withChoices);
});

test("Start refining opens a menu: 'T3 default' first, then each provider instance with its models", async () => {
  await mountItem(withChoices);
  expect([text(start()), start().getAttribute('aria-haspopup'), start().getAttribute('aria-expanded'), start().getAttribute('aria-label')])
    .toEqual(['Start refining ▾', 'menu', 'false', `Start refining #129 ${sample.items.find((i) => i.id === 'I_sample05')!.title}`]);
  expect(menu()).toBeNull();
  await open();
  expect(start().getAttribute('aria-expanded')).toBe('true');
  expect(menu()!.getAttribute('aria-label')).toBe('Start #129 with');
  expect(entries().map((e) => [text(e), e.getAttribute('aria-checked'), e.dataset.startPick, e.dataset.instanceId, e.dataset.model])).toEqual([
    ['T3 default', 'true', 'I_sample05', undefined, undefined],
    ['GPT-5.5', 'false', 'I_sample05', 'codex', 'gpt-5.5'],
    ['Opus 5.5', 'false', 'I_sample05', 'claudeAgent', 'claude-opus-5-5'],
    ['claude-opus-5-5[1m]', 'false', 'I_sample05', 'claudeAgent', 'claude-opus-5-5[1m]'],
  ]);
  const label = (g: Element) => text(document.getElementById(g.getAttribute('aria-labelledby')!));
  expect(label($('[role="menu"] > * > [role="group"]')!), 'the entries are a group, headed "Start with"').toBe('Start with');
  const groups = $$('[role="menu"] [role="group"] [role="group"][aria-labelledby]');
  expect(groups.map(label), 'grouped by instance, by its name').toEqual(['Codex', 'VI <work>']);
  expect(document.activeElement, 'focus is on the highlighted entry').toBe(entries()[0]);
});

test('the menu highlights the remembered model choice while it is offered, else "T3 default"', async () => {
  localStorage.setItem(CHOICE_KEY, JSON.stringify({ instanceId: 'claudeAgent', model: 'claude-opus-5-5[1m]' }));
  await mountItem(withChoices);
  await open();
  expect(checked()).toEqual(['claude-opus-5-5[1m]']);
  expect(document.activeElement).toBe(entries()[3]);
});

test('a remembered choice no longer offered highlights "T3 default"', async () => {
  localStorage.setItem(CHOICE_KEY, JSON.stringify({ instanceId: 'claudeAgent', model: 'gpt-5.5' }));
  await mountItem(withChoices);
  await open();
  expect(checked()).toEqual(['T3 default']);
});

test('without model choices, the menu offers only "T3 default"', async () => {
  await mountItem();
  await open();
  expect(entries().map(text)).toEqual(['T3 default']);
  expect($$('[role="menu"] [role="group"] [role="group"][aria-labelledby]')).toEqual([]);
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

test('a click outside closes the menu; a control it lands on keeps focus', async () => {
  await mountItem(withChoices);
  await open();
  const other = card().querySelector<HTMLButtonElement>('[data-back-to-list="I_sample05"]')!;
  await pressOutside(other);
  other.focus();
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(other);
});

test('picking an entry starts the item with that model, shows the thread, and remembers the choice', async () => {
  await mountItem(withChoices);
  await open();
  await press(entries()[2]!);
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample05', model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' } }]]);
  expect(menu()).toBeNull();
  expect([text(start()), start().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);
  expect(document.activeElement, 'focus is back on Start').toBe(start());
  expect(footer(), 'no Back to List or Abandon while Start is pending').toBeNull();
  await press(start());
  expect(menu(), 'no menu while a start is in flight').toBeNull();

  const thread = { threadId: 'thread-1', title: '#129 Run more than one 4K HDR to 1080p stream at a time' };
  await answer({ thread, error: null });
  const tag = card().querySelector('[data-start-result]')!;
  expect([tag.classList.contains('started-tag'), tag.getAttribute('data-slot'), tag.className.includes('bg-success/8'), text(tag), tag.getAttribute('title')])
    .toEqual([true, 'badge', true, 'Started', 'T3 thread thread-1']);
  expect(card().querySelector('[data-start]'), 'the dialog keeps only a quiet tag').toBeNull();
  expect(footer()).toBeNull();
  expect(document.activeElement, 'focus moves to the tag').toBe(tag);
  expect(text(toast()), 'the toast does not repeat a title that is the work message title').toBe(`Started T3 thread thread-1 for ${thread.title}.`);
  expect(toast()!.querySelector('code.thread-id')).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!)).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
  await openItem('I_sample06');
  await open('I_sample06');
  expect(checked(), 'the next menu highlights it').toEqual(['Opus 5.5']);
});

test('a title T3 chose differently is in the toast', async () => {
  await mountItem(withChoices);
  await open();
  await press(entries()[0]!);
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample05' }]]);
  await answer({ thread: { threadId: 'thread-1', title: 'Renamed' }, error: null });
  expect(toast()!.querySelector('b')?.textContent).toBe('Renamed');
  expect(localStorage.getItem(CHOICE_KEY), '"T3 default" stores as null').toBe('null');
});

test('a failed Start shows in the dialog, keeps Back to List and the last choice, and offers Retry start', async () => {
  localStorage.setItem(CHOICE_KEY, JSON.stringify({ instanceId: 'codex', model: 'gpt-5.5' }));
  await mountItem(withChoices);
  await open();
  await press(entries()[2]!);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(start())).toBe('Retry start ▾');
  expect(text(card().querySelector('p.start [role="alert"]'))).toBe('T3 is down.');
  expect(footer(), 'a failed Start brings Back to List and Abandon back').not.toBeNull();
  expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!), 'a failure keeps the previous choice').toEqual({ instanceId: 'codex', model: 'gpt-5.5' });
  const close = card().querySelector<HTMLButtonElement>('p.start button.dismiss')!;
  expect(close.getAttribute('aria-label')).toBe('Dismiss error for #129');
  close.focus();
  await settle(() => close.click());
  expect(card().querySelector('p.start')).toBeNull();
  expect(text(start())).toBe('Start refining ▾');
  expect(document.activeElement).toBe(card().querySelector('[data-back-to-list]'));
});

test('a Start that may have run hides Start, Back to List and Abandon; closing its message leaves a tag', async () => {
  await mountItem(withChoices);
  await open();
  await press(entries()[1]!);
  await answer({ thread: null, uncertain: true, error: 'Check T3.' });
  expect(card().querySelector('[data-start]')).toBeNull();
  expect(footer()).toBeNull();
  const message = card().querySelector<HTMLElement>('p.start[data-start-result]')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
  expect(document.activeElement, 'focus moves to the message').toBe(message);
  expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!), 'it may have started, so the choice is kept').toEqual({ instanceId: 'codex', model: 'gpt-5.5' });
  await settle(() => message.querySelector<HTMLButtonElement>('button.dismiss')!.click());
  const tag = card().querySelector('.started-tag.unsure')!;
  expect([tag.getAttribute('data-slot'), tag.className.includes('bg-warning/8'), text(tag), tag.getAttribute('title')])
    .toEqual(['badge', true, 'May have started', 'Check T3 before starting it again']);
  expect(card().querySelector('[data-start]')).toBeNull();
  expect(footer()).toBeNull();
});

test('a thread another page started shows on every page', async () => {
  await mountItem({ ...withChoices, started: { I_sample06: { threadId: 'thread-9', title: 'x' } } }, 'I_sample06');
  expect(card().querySelector('.started-tag')?.getAttribute('title')).toBe('T3 thread thread-9');
  expect(card().querySelector('[data-start]')).toBeNull();
  expect(footer()).toBeNull();
});

test('in sample mode, Start still opens its menu, and no entry in it starts anything', async () => {
  await mountItem({ ...withChoices, capture: { session: 's', enabled: false } });
  expect(start().hasAttribute('disabled')).toBe(false);
  await open();
  expect(entries().length).toBeGreaterThan(1);
  expect(entries().every((e) => e.getAttribute('aria-disabled') === 'true' && e.title === 'Disabled in sample mode')).toBe(true);
  await press(entries()[1]!);
  expect(posted()).toEqual([]);
});
