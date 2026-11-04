// Looping animations and the title bar's refreshed ping behind an open blurred modal: the page's CSS pauses each of them under the last open overlay,
// and leaves the topmost modal, its popups, the toasts and the open board running. jsdom runs no animations, so this
// checks which rendered elements the pause rule from the page's CSS matches.

import { expect, test } from 'vite-plus/test';
import { $, $$, addStylesheet, mountPage, pressMenu, settle, text } from '../test/support.ts';

const LOOPS = ['status-spin', 'status-pulse', 'activity-sweep', 'animate-spin', 'motion-safe:animate-spin', 'animate-pulse', 'lar-skeleton'];

/** The selectors of the page's rules that pause an animation, with a pseudo-element's rule read as its element's. */
const pauseRules = () => [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules])
  .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.getPropertyValue('animation-play-state') === 'paused')
  .map((rule) => rule.selectorText.replace(/::before/g, ''));
const paused = (el: Element) => pauseRules().some((selector) => el.matches(selector));

/** Puts each named loop inside `parent` and answers which of them the pause rule matches. */
function loopsPaused(parent: Element): string[] {
  const probes = LOOPS.map((name) => {
    const probe = document.createElement('span');
    probe.className = name;
    return parent.appendChild(probe);
  });
  const matched = LOOPS.filter((_, i) => paused(probes[i]!));
  probes.forEach((probe) => probe.remove());
  return matched;
}

const board = () => $('#app')!;
const openItem = async (itemId: string) => {
  const { useItemDialogStore } = await import('./item-dialog/item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
};
const itemDialog = () => $('[data-item-dialog]')!;
const footerButton = (name: string) => [...itemDialog().querySelectorAll<HTMLButtonElement>('[data-slot="modal-footer"] button')].find((b) => text(b).startsWith(name))!;
const confirmation = () => $('#abandon-dialog');
const closeTop = () => settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

async function boardWithStyles(): Promise<void> {
  await mountPage();
  addStylesheet();
}

test('the board\'s loops run while nothing is open, and pause under an open modal until it closes', async () => {
  await boardWithStyles();
  const rendered = () => $$('#app .status-spin, #app .status-pulse');
  expect(rendered().length, 'the sample board renders status loops').toBeGreaterThan(0);
  expect(rendered().filter(paused)).toEqual([]);
  expect(loopsPaused(board())).toEqual([]);

  await openItem('I_sample01');
  expect(rendered().filter((el) => !paused(el))).toEqual([]);
  expect(loopsPaused(board())).toEqual(LOOPS);
  expect(loopsPaused(itemDialog()), 'the modal keeps its own').toEqual([]);

  await closeTop();
  await settle();
  expect($('[data-slot="modal-overlay"][data-state="open"]')).toBeNull();
  expect(rendered().filter(paused)).toEqual([]);
  expect(loopsPaused(board())).toEqual([]);
});

test('a drawer\'s overlay pauses the loops behind it as a modal\'s does', async () => {
  await boardWithStyles();
  await openItem('I_sample01');
  $('[data-slot="modal-overlay"]')!.setAttribute('data-slot', 'drawer-overlay');
  expect(loopsPaused(board())).toEqual(LOOPS);
});

test('with stacked modals only the topmost keeps its loops, and the lower one resumes when the top closes', async () => {
  await boardWithStyles();
  await openItem('I_sample01');
  await settle(() => footerButton('Abandon').click());
  expect($$('body > [data-slot="modal-overlay"][data-state="open"]').length, 'each overlay is a child of body').toBe(2);
  expect(loopsPaused(board())).toEqual(LOOPS);
  expect(loopsPaused(itemDialog())).toEqual(LOOPS);
  expect(loopsPaused(confirmation()!)).toEqual([]);

  await closeTop();
  await settle();
  expect(confirmation()).toBeNull();
  expect(loopsPaused(board())).toEqual(LOOPS);
  expect(loopsPaused(itemDialog())).toEqual([]);
});

test('the title bar\'s refreshed ping pauses under a modal and keeps playing on the open board and inside the modal', async () => {
  await boardWithStyles();
  const ping = (parent: Element) => {
    const probe = parent.appendChild(document.createElement('span'));
    probe.toggleAttribute('data-ping', true);
    return probe;
  };
  expect(paused(ping(board()))).toBe(false);
  await openItem('I_sample01');
  expect(paused(ping(board()))).toBe(true);
  expect(paused(ping(itemDialog()))).toBe(false);
});

test('a one-shot entrance behind a modal plays on, so nothing behind it stays at opacity 0', async () => {
  await boardWithStyles();
  await openItem('I_sample01');
  const entrance = board().appendChild(document.createElement('span'));
  entrance.className = 'animate-in fade-in-0';
  expect(paused(entrance)).toBe(false);
});

test('a popover on the open board leaves every loop running', async () => {
  await boardWithStyles();
  await settle(() => $('.counters button[aria-label^="building:"]')!.click());
  expect(loopsPaused($('[data-slot="popover-content"]')!)).toEqual([]);
  expect(loopsPaused(board())).toEqual([]);
});

test('a menu opened from a modal mounts above its overlay and keeps its loops', async () => {
  await boardWithStyles();
  await openItem('I_sample05');
  await pressMenu(footerButton('Shape issue'));
  const menu = $('[role="menu"]')!;
  expect(menu.compareDocumentPosition($('[data-slot="modal-overlay"]')!) & Node.DOCUMENT_POSITION_PRECEDING, 'the menu mounts after the overlay').toBeTruthy();
  expect(loopsPaused(menu)).toEqual([]);
});

test('a toast over a modal keeps its loops', async () => {
  await boardWithStyles();
  await openItem('I_sample01');
  const { showToast } = await import('./notices/toasts.tsx');
  await settle(() => showToast({ slot: 'success', what: 'Saved', body: 'Saved' }));
  const toaster = $('[data-slot="toaster"]')!;
  expect(toaster.parentElement, 'the toaster is a child of body').toBe(document.body);
  expect(toaster.compareDocumentPosition($('[data-slot="modal-overlay"]')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the toaster mounts before the overlay').toBeTruthy();
  expect(loopsPaused(toaster.querySelector('[data-toast]')!)).toEqual([]);
});
