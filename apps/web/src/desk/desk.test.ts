// Your desk: Ready, Needs you, Verify and Ready to merge items as cards in one sideways row, each opening the item dialog
// and carrying the buttons for its next action; and the line's heading below it.

import { expect, test } from 'vite-plus/test';
import type { BoardData, Item } from '@lar-factory/shared';
import { $, $$, mountPage, pressMenu, sample, settle, text } from '../../test/support.ts';

const cards = () => $$('.desk-card');
const card = (id: string) => $(`.desk-card[data-item="${id}"]`)!;
/** A card's buttons and links, as their text, an icon button's name in brackets, with a disabled one's title. */
const controls = (id: string) => [...card(id).querySelectorAll('.desk-actions :is(button, a)')]
  .map((b) => (text(b) || `[${b.getAttribute('aria-label')}]`) + ((b as HTMLButtonElement).disabled ? ` (disabled: ${b.getAttribute('title')})` : ''));
/** The card's next-step line. */
const nextLine = (id: string) => text(card(id).querySelector('.desk-next'));
const dialog = () => $('[data-item-dialog]');
const withItem = (id: string, change: Partial<Item>): BoardData =>
  ({ ...sample, items: sample.items.map((i) => (i.id === id ? { ...i, ...change } : i)) });

test('the desk shows what only you can move, counted, as cards in one row that scrolls sideways with no scrollbar', async () => {
  await mountPage();
  expect(text($('#desk-h'))).toBe('Your desk 8');
  const statuses = cards().map((c) => sample.items.find((i) => i.id === c.dataset.item)!.status);
  expect(new Set(statuses)).toEqual(new Set(['Ready', 'Needs you', 'Verify', 'Ready to merge']));
  expect(cards()).toHaveLength(8);
  const row = cards()[0]!.parentElement!.className.split(' ');
  expect(row).toEqual(expect.arrayContaining(['-mx-6', 'px-6', 'overflow-x-auto', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden']));
});

test('a desk card shows its status, repository and age, numbered title, next step and status track, in that order', async () => {
  await mountPage();
  const rows = [...card('I_sample16').querySelector('button')!.children];
  expect(rows.slice(0, 3).map(text)).toEqual(['Verify· lar-apple · 1h ago', '#31 New artwork grid layout', 'can merge · 1 passed']);
  expect(rows[3]!.querySelectorAll('ol > li')).toHaveLength(10);
});

test("a desk card's title is always two lines tall, cut short, with the whole title in its tooltip", async () => {
  await mountPage();
  const title = card('I_sample28').querySelector('.desk-title')!;
  expect(title.className.split(' ')).toEqual(expect.arrayContaining(['line-clamp-2', 'h-10']));
  expect(title.getAttribute('title')).toBe('#147 Fall back to software transcoding when the GPU is busy');
});

test('every desk card has the same rows at the same heights, and the row lets a card with a start message grow alone', async () => {
  await mountPage();
  const heights = (c: HTMLElement) => [c.querySelector('.desk-meta'), c.querySelector('.desk-title'), c.querySelector('.desk-next'), c.querySelector('.desk-actions')]
    .map((row) => row?.className.split(' ').find((name) => /^h-\d+$/.test(name)));
  for (const c of cards()) expect(heights(c)).toEqual(['h-4', 'h-10', 'h-4', 'h-7']);
  expect(cards()[0]!.parentElement!.className.split(' ')).toContain('items-start');
});

test('a desk card opens the item dialog and stays marked while it shows', async () => {
  await mountPage();
  await settle(() => card('I_sample17').click());
  expect(dialog()!.textContent).toContain('Cache probe results between restarts');
  expect(card('I_sample17').className).toContain('ring-2');
});

test('a desk card is no button wrapping buttons: its summary is the button, and pressing it opens the item dialog', async () => {
  await mountPage();
  expect($$('.desk-card button button, button.desk-card')).toHaveLength(0);
  await settle(() => card('I_sample16').querySelector<HTMLButtonElement>(':scope > button')!.click());
  expect(dialog()!.textContent).toContain('New artwork grid layout');
});

const noBlockers = (data: BoardData = sample) => ({ ...data, items: data.items.map((i) => (i.id === 'I_sample13' ? { ...i, blockers: [] } : i)) });
const liveThread = [{ id: 't1', title: 'Build', state: 'running' as const, updated: '2026-10-21T09:00:00.000Z' }];
const NO_THREAD = 'No T3 thread has worked on this yet';
const NO_PROJECT = 'T3 Code has no project for maddec01/lar-server';

test.each<[string, BoardData, string, string, string[]]>([
  ['Needs you with no thread', sample, 'I_sample11', 'Answer in its T3 thread', [`Open thread (disabled: ${NO_THREAD})`]],
  ['Needs you', sample, 'I_sample12', 'Answer in its T3 thread', ['Open thread']],
  ['Needs you with a linked PR', withItem('I_sample12', { linkedPrs: sample.items.find((i) => i.id === 'I_sample16')!.linkedPrs }), 'I_sample12', 'Answer in its T3 thread', ['Open thread']],
  ['Ready with a thread at work on it', withItem('I_sample13', { threads: liveThread }), 'I_sample13', 'A thread is at work on it', ['Open thread']],
  ['Ready held by open blockers', withItem('I_sample13', { blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' }, { number: 9, repo: 'maddec01/lar-apple', state: 'open' }, { number: 7, repo: 'maddec01/lar-server', state: 'closed' }] }),
    'I_sample13', 'Waits on #202, lar-apple#9', ['Start after lar-apple#9 ▾', '[Open thread]']],
  ['Ready held by its repository', { ...noBlockers(), repositoryProjects: { 'maddec01/lar-server': NO_PROJECT } }, 'I_sample13', NO_PROJECT, [`Start build (disabled: ${NO_PROJECT})`, '[Open thread]']],
  ['Ready with nothing holding it', noBlockers(), 'I_sample13', 'Ready to build', ['Start build ▾', '[Open thread]']],
  ['Verify', sample, 'I_sample16', 'can merge · 1 passed', ['Open PR', `[Open thread] (disabled: ${NO_THREAD})`]],
  ['Ready to merge', sample, 'I_sample17', 'can merge · 4 passed · 1 failed', ['Open PR', `[Open thread] (disabled: ${NO_THREAD})`]],
  ['Verify with no PR', withItem('I_sample16', { linkedPrs: [] }), 'I_sample16', 'Test it with the steps in the PR, then merge',
    ['Open PR (disabled: No pull request is linked to this item yet)', `[Open thread] (disabled: ${NO_THREAD})`]],
])('a %s card says its next step and has its action on the left, Open thread in the corner unless that is the action', async (_card, data, id, next, buttons) => {
  await mountPage(data);
  expect([nextLine(id), controls(id)]).toEqual([next, buttons]);
});

test("Open thread in a card's corner is a square icon button named and titled Open thread", async () => {
  await mountPage(noBlockers());
  const corner = card('I_sample13').querySelector('.desk-actions [data-open-thread]')!;
  expect([corner.getAttribute('aria-label'), corner.getAttribute('title'), corner.getAttribute('data-icon-only')]).toEqual(['Open thread', 'Open thread', '']);
});

test('Open thread opens the latest thread in T3, and Open PR the pull request the item dialog links, in a new tab', async () => {
  await mountPage();
  expect(card('I_sample12').querySelector('[data-open-thread]')!.getAttribute('href')).toMatch(/^t3code:\/\//);
  const pr = card('I_sample16').querySelector<HTMLAnchorElement>('[data-pr-link]')!;
  expect([pr.getAttribute('href'), pr.target]).toEqual(['https://github.com/maddec01/lar-apple/pull/32', '_blank']);
});

test.each([
  ['an issue whose PR GitHub is still checking', 'I_sample26', 'checking · 4 passed · 2 running'],
  ['an issue whose PR is blocked', 'I_sample27', 'blocked · 3 passed · 1 failed'],
  ['an issue whose PR has no checks and conflicts', 'I_sample28', 'conflicts · no checks'],
])('a Verify card for %s says its merge state, then its checks leaving out zero counts other than passed', async (_what, id, line) => {
  await mountPage();
  expect(nextLine(id)).toBe(line);
});

test('a Verify card reads the PR Open PR opens, its first linked one', async () => {
  const linkedPrs = (id: string) => sample.items.find((i) => i.id === id)!.linkedPrs;
  await mountPage(withItem('I_sample16', { linkedPrs: [...linkedPrs('I_sample16'), { ...linkedPrs('I_sample27')[0]!, number: 99 }] }));
  expect(nextLine('I_sample16')).toBe('can merge · 1 passed');
});

test("clicks on a card's buttons, in the menu one opens, or in its start message open no item dialog", async () => {
  await mountPage();
  await settle(() => card('I_sample12').querySelector<HTMLElement>('[data-open-thread]')!.click());
  await settle(() => card('I_sample16').querySelector<HTMLElement>('[data-pr-link]')!.click());
  const after = card('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  await pressMenu(after);
  await settle(() => after.click());
  const entry = $('[role="menu"] [role="menuitemradio"]');
  expect(entry).not.toBeNull();
  await settle(() => entry!.click());
  await settle(() => card('I_sample13').querySelector<HTMLElement>('.desk-start')!.click());
  expect(dialog()).toBeNull();
});

test('a click on a card beside its buttons opens the item dialog', async () => {
  await mountPage();
  await settle(() => card('I_sample12').querySelector<HTMLElement>('.desk-actions')!.click());
  expect(dialog()).not.toBeNull();
});

test('an empty desk says the line runs without you', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => !['Ready', 'Needs you', 'Verify', 'Ready to merge'].includes(i.status)) });
  expect(text($('#desk-h'))).toBe('Your desk 0');
  expect(text($('.desk p'))).toBe('Desk clear. The line runs without you.');
});

test('the line follows the desk under its heading', async () => {
  await mountPage();
  expect(text($('#line-h'))).toBe('The line');
  expect($('.desk')!.compareDocumentPosition($('.line')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
