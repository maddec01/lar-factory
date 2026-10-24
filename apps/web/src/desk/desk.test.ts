// Your desk: Needs you, Verify and Ready to merge items as cards in one sideways row, each opening the item dialog;
// and the line's heading below it.

import { expect, test } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle, text } from '../../test/support.ts';

const cards = () => $$<HTMLButtonElement>('.desk-card');

test('the desk shows what only you can move, counted, as cards in one row that scrolls sideways with no scrollbar', async () => {
  await mountPage();
  expect(text($('#desk-h'))).toBe('Your desk 4');
  const statuses = cards().map((c) => sample.items.find((i) => i.id === c.dataset.item)!.status);
  expect(new Set(statuses)).toEqual(new Set(['Needs you', 'Verify', 'Ready to merge']));
  expect(cards()).toHaveLength(4);
  const row = cards()[0]!.parentElement!.className.split(' ');
  expect(row).toEqual(expect.arrayContaining(['-mx-6', 'px-6', 'overflow-x-auto', '[scrollbar-width:none]', '[&::-webkit-scrollbar]:hidden']));
});

test('a desk card shows its status, repository, age, numbered title, hint and status track', async () => {
  await mountPage();
  const card = $('.desk-card[data-item="PVTI_sample16"]')!;
  const [meta, title, hint] = [...card.children].map(text);
  expect([meta, title, hint]).toEqual(['Verify· Apple · 1h ago', '#31 New artwork grid layout', 'Test it with the steps in the PR, then merge']);
  expect(card.querySelectorAll('ol > li')).toHaveLength(10);
});

test('a desk card opens the item dialog and stays marked while it shows', async () => {
  await mountPage();
  const card = () => $<HTMLButtonElement>('.desk-card[data-item="PVTI_sample17"]')!;
  await settle(() => card().click());
  expect($('[data-item-dialog]')!.textContent).toContain('Cache probe results between restarts');
  expect(card().className).toContain('ring-2');
});

test('an empty desk says the line runs without you', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => !['Needs you', 'Verify', 'Ready to merge'].includes(i.status)) });
  expect(text($('#desk-h'))).toBe('Your desk 0');
  expect(text($('.desk p'))).toBe('Desk clear. The line runs without you.');
});

test('the line follows the desk under its heading', async () => {
  await mountPage();
  expect(text($('#line-h'))).toBe('The line');
  expect($('.desk')!.compareDocumentPosition($('.line')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
