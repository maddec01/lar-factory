// A build card's slice popover: it opens on hover, focus or tap, a second click or tap closes it,
// Enter or Space toggles it, Escape closes it, and new data keeps it open. Ported from the popover
// case of test/render.test.ts; the state machine itself is tested in test/slice-popover.test.ts.

import { expect, test } from 'vite-plus/test';
import { $, mountPage, sample, settle } from './support.ts';

// Owner accounts (#140), a build with three slices.
const ID = 'PVTI_sample13';
const block = (id = ID) => $(`[data-slices="${id}"]`)!;
const trigger = (id = ID) => block(id).querySelector<HTMLElement>('.slices-trigger')!;
const pop = (id = ID) => document.getElementById(`slices-${id}`);
/** The card's popover is open: its trigger says so and its popup shows. */
const isOpen = (id = ID) => {
  const expanded = trigger(id).getAttribute('aria-expanded') === 'true';
  expect(block(id).classList.contains('open'), 'the block marks it open as its trigger does').toBe(expanded);
  expect(Boolean(pop(id) && !pop(id)!.closest('[hidden]')), 'the popup shows when it is open').toBe(expanded);
  return expanded;
};

const pointer = (type: string, el: Element, pointerType = 'mouse') =>
  settle(() => el.dispatchEvent(new PointerEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', cancelable: true, pointerType })));
const hover = (el: Element) => pointer('pointerover', el).then(() => pointer('pointerenter', el));
const unhover = (el: Element) => pointer('pointerout', el).then(() => pointer('pointerleave', el));
const focus = (el: HTMLElement) => settle(() => el.focus());
const blur = () => settle(() => (document.activeElement as HTMLElement).blur());
/** A click or tap: the press, then the click that follows it. */
const tap = (el: HTMLElement, pointerType = 'mouse') => pointer('pointerdown', el, pointerType).then(() => settle(() => el.click()));
const key = (el: Element, k: string, type = 'keydown') => settle(() => el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true })));
/** A key press as the browser sends it: down, then up. */
const press = (el: Element, k: string) => key(el, k).then(() => key(el, k, 'keyup'));

test('it lists the slices behind a disclosure trigger, closed until asked', async () => {
  await mountPage();
  expect(isOpen()).toBe(false);
  expect(['role', 'tabindex'].map((a) => trigger().getAttribute(a))).toEqual(['button', '0']);
  expect(pop()!.classList.contains('slices-pop')).toBe(true);
  expect(trigger().getAttribute('aria-controls')).toBe(pop()!.id);
  expect([...pop()!.querySelectorAll('li.slice-row')].map((li) => li.classList[2])).toEqual(['active', 'waiting', 'done']);
});

test('it opens while the pointer is over the bars or the popover, and closes when the pointer leaves', async () => {
  await mountPage();
  await hover(trigger());
  expect(isOpen()).toBe(true);
  await unhover(block());
  expect(isOpen()).toBe(false);
});

test('it opens while focus is on its trigger or a slice link, and closes when focus leaves the card', async () => {
  await mountPage();
  await focus(trigger());
  expect(isOpen()).toBe(true);
  await focus(pop()!.querySelector('a')!);
  expect(isOpen(), 'focus moved into the popover').toBe(true);
  expect(document.activeElement?.closest('.slices-pop')).toBe(pop());
  await blur();
  expect(isOpen()).toBe(false);
});

test('opening on focus leaves focus on the trigger', async () => {
  await mountPage();
  await focus(trigger());
  expect(document.activeElement).toBe(trigger());
});

test('a tap pins it open and a second tap closes it, while focus stays', async () => {
  await mountPage();
  await focus(trigger());
  await tap(trigger(), 'touch');
  await blur();
  expect(isOpen(), 'pinned after focus leaves').toBe(true);
  await focus(trigger());
  await tap(trigger(), 'touch');
  expect(isOpen()).toBe(false);
  await tap(trigger(), 'touch');
  expect(isOpen(), 'a third tap opens it again').toBe(true);
});

test('the first click keeps a hovered popover open, and a second click closes it until the pointer and focus leave', async () => {
  await mountPage();
  await hover(trigger());
  await focus(trigger());
  await tap(trigger());
  expect(isOpen()).toBe(true);
  await tap(trigger());
  expect(isOpen()).toBe(false);
  await blur();
  await unhover(block());
  await hover(trigger());
  expect(isOpen()).toBe(true);
});

test('a press outside closes a pinned popover', async () => {
  await mountPage();
  await tap(trigger(), 'touch');
  expect(isOpen()).toBe(true);
  await pointer('pointerdown', document.body, 'touch');
  await settle(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
  expect(isOpen()).toBe(false);
});

test('Enter and Space on the trigger toggle it', async () => {
  await mountPage();
  await focus(trigger());
  await key(trigger(), 'Enter');
  expect(isOpen()).toBe(false);
  await key(trigger(), 'Enter');
  expect(isOpen()).toBe(true);
  await key(trigger(), ' ');
  expect(isOpen()).toBe(false);
});

test('Space toggles it on the key press as a whole, as Enter does', async () => {
  await mountPage();
  await focus(trigger());
  await press(trigger(), ' ');
  expect(isOpen(), 'Space closes the popover focus opened').toBe(false);
  await press(trigger(), ' ');
  expect(isOpen()).toBe(true);
  await press(trigger(), ' ');
  expect(isOpen()).toBe(false);
});

test('Escape closes it and returns focus from a slice link to the trigger; it opens again once focus leaves and returns', async () => {
  await mountPage();
  await focus(trigger());
  await focus(pop()!.querySelector('a')!);
  await key(document.activeElement!, 'Escape');
  expect(isOpen()).toBe(false);
  expect(document.activeElement).toBe(trigger());
  await hover(trigger());
  expect(isOpen(), 'still closed under the pointer').toBe(false);
  await unhover(block());
  await blur();
  await focus(trigger());
  expect(isOpen()).toBe(true);
});

test('Escape inside another dialog leaves it open, while Escape inside the popover still closes it', async () => {
  await mountPage();
  await hover(trigger());
  // Base UI's own dialogs stop Escape before it reaches the popover, so this is a dialog that lets
  // it bubble.
  const other = document.body.appendChild(document.createElement('div'));
  other.setAttribute('role', 'dialog');
  const field = other.appendChild(document.createElement('input'));
  await focus(field);
  await key(field, 'Escape');
  expect(isOpen(), 'the other dialog had the key').toBe(true);
  await focus(pop()!.querySelector('a')!);
  await key(document.activeElement!, 'Escape');
  expect(isOpen()).toBe(false);
});

test('the hovered popover wins over the focused one', async () => {
  await mountPage();
  await focus(trigger());
  await hover(trigger('PVTI_sample22'));
  expect([isOpen(), isOpen('PVTI_sample22')]).toEqual([false, true]);
  await unhover(block('PVTI_sample22'));
  expect([isOpen(), isOpen('PVTI_sample22')]).toEqual([true, false]);
});

test('new data keeps it open, with focus where it was', async () => {
  await mountPage();
  await tap(trigger(), 'touch');
  await focus(pop()!.querySelector('a')!);
  const link = document.activeElement;
  const { useBoardStore } = await import('../src/app/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, fetchedAt: '2026-10-21T09:59:00.000Z' }));
  expect(isOpen()).toBe(true);
  expect(document.activeElement).toBe(link);
});
