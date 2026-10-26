// Your desk: Ready, Needs you, Verify and Ready to merge items as cards in one sideways row, each opening the item dialog
// and carrying the buttons for its next action; and the line's heading below it.

import { expect, test } from 'vite-plus/test';
import type { BoardData, Item } from '@lar-factory/shared';
import { $, $$, mountPage, sample, settle, text } from '../../test/support.ts';

const cards = () => $$('.desk-card');
const card = (id: string) => $(`.desk-card[data-item="${id}"]`)!;
/** A card's buttons and links, as their text, with a disabled one's title. */
const controls = (id: string) => [...card(id).querySelectorAll('.desk-actions :is(button, a)')]
  .map((b) => text(b) + ((b as HTMLButtonElement).disabled ? ` (disabled: ${b.getAttribute('title')})` : ''));
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

test('a desk card shows its status, repository, age, numbered title, hint and status track', async () => {
  await mountPage();
  const [meta, title, hint] = [...card('I_sample16').querySelector('button')!.children].map(text);
  expect([meta, title, hint]).toEqual(['Verify· Apple · 1h ago', '#31 New artwork grid layout', 'Test it with the steps in the PR, then merge']);
  expect(card('I_sample16').querySelectorAll('ol > li')).toHaveLength(10);
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

test.each([
  ['Needs you with no thread', 'I_sample11', ['Open thread (disabled: No T3 thread has worked on this yet)']],
  ['Needs you', 'I_sample12', ['Open thread']],
  ['blocked Ready', 'I_sample13', ['Open thread', 'Start build (disabled: Blocked by #202 until it closes)', 'Start after #202 ▾']],
  ['Verify', 'I_sample16', ['Open thread (disabled: No T3 thread has worked on this yet)', 'Open PR']],
  ['Ready to merge', 'I_sample17', ['Open thread (disabled: No T3 thread has worked on this yet)', 'Open PR']],
])('a %s card has the buttons for its next action', async (_status, id, buttons) => {
  await mountPage();
  expect(controls(id)).toEqual(buttons);
});

test('a Ready card with a thread at work on it has Open thread alone, not a second one in Start build’s place', async () => {
  const threads = [{ id: 't1', title: 'Build', state: 'running' as const, updated: '2026-10-21T09:00:00.000Z' }];
  await mountPage(withItem('I_sample13', { threads }));
  expect(controls('I_sample13')).toEqual(['Open thread']);
});

test('a Ready card for an issue that also carries Verify offers neither Start build nor Start after until one is kept', async () => {
  await mountPage(withItem('I_sample13', { statuses: ['Ready', 'Verify'] }));
  expect(controls('I_sample13')).toEqual(['Open thread']);
});

test('Open thread opens the latest thread in T3, and Open PR the pull request the item dialog links, in a new tab', async () => {
  await mountPage();
  expect(card('I_sample12').querySelector('[data-open-thread]')!.getAttribute('href')).toMatch(/^t3code:\/\//);
  const pr = card('I_sample16').querySelector<HTMLAnchorElement>('[data-pr-link]')!;
  expect([pr.getAttribute('href'), pr.target]).toEqual(['https://github.com/maddec01/lar-apple/pull/32', '_blank']);
});

test('a pull request on Verify opens itself', async () => {
  await mountPage(withItem('I_sample16', { content: 'pr', url: 'https://github.com/maddec01/lar-apple/pull/40' }));
  expect(card('I_sample16').querySelector('[data-pr-link]')!.getAttribute('href')).toBe('https://github.com/maddec01/lar-apple/pull/40');
});

test('with no pull request linked, Open PR is disabled, saying why', async () => {
  await mountPage(withItem('I_sample17', { linkedPrs: [] }));
  expect(controls('I_sample17').at(-1)).toBe('Open PR (disabled: No pull request is linked to this item yet)');
});

const pipeline = (id: string) => [...card(id).querySelector('.desk-pipeline')!.children].map(text);

test.each([
  ['an issue whose PR can merge', 'I_sample16', ['1 passed · 0 running · 0 failed', 'can merge']],
  ['a pull request GitHub is still checking', 'I_sample26', ['4 passed · 2 running · 0 failed', 'checking']],
  ['an issue whose PR is blocked', 'I_sample27', ['3 passed · 0 running · 1 failed', 'blocked']],
  ['an issue whose PR has no checks and conflicts', 'I_sample28', ['no checks', 'conflicts']],
])('a Verify card for %s shows its checks and merge state', async (_what, id, lines) => {
  await mountPage();
  expect(pipeline(id)).toEqual(lines);
});

test('a Verify card reads the PR Open PR opens, its first linked one', async () => {
  const linkedPrs = (id: string) => sample.items.find((i) => i.id === id)!.linkedPrs;
  await mountPage(withItem('I_sample16', { linkedPrs: [...linkedPrs('I_sample16'), { ...linkedPrs('I_sample27')[0]!, number: 99 }] }));
  expect(pipeline('I_sample16')).toEqual(['1 passed · 0 running · 0 failed', 'can merge']);
});

test('a Verify card with no PR linked shows no pipeline, and only Verify cards show one', async () => {
  await mountPage(withItem('I_sample16', { linkedPrs: [] }));
  expect(card('I_sample16').querySelector('.desk-pipeline')).toBeNull();
  expect(card('I_sample17').querySelector('.desk-pipeline')).toBeNull();
});

test('clicks on a card’s buttons, in the menu one opens, or in its start message open no item dialog', async () => {
  await mountPage();
  await settle(() => card('I_sample12').querySelector<HTMLElement>('[data-open-thread]')!.click());
  await settle(() => card('I_sample16').querySelector<HTMLElement>('[data-pr-link]')!.click());
  await settle(() => card('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!.click());
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
