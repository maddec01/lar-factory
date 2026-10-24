// The page draws T3 Code's title bar above the header, in the Mac app and in a browser: the logo, "Factory" and the
// "for T3 Code" pill on the left, and the Refreshed time and the board's actions at its right end.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle, stubApp } from '../../test/support.ts';

const titleBar = () => $<HTMLElement>('.title-bar');
const actions = () => $<HTMLElement>('.title-bar-actions');

test('in the Mac app, the title bar holds the brand, then Refreshed, the update icon, Add item and Settings at its right end', async () => {
  stubApp({ secret: 'launch-secret' });
  await mountPage();
  expect(titleBar()!.className).toContain('pl-[89px]');
  expect(titleBar()!.compareDocumentPosition($('header.top')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...actions()!.children].map((el) => el.textContent)).toEqual(['Refreshed 20m ago', '', 'Add item', 'Settings']);
  expect(actions()!.children[1]!.querySelector('.update-button')).not.toBeNull();
  expect($('header.top button')).toBeNull();
  expect($('header.top .refreshed')).toBeNull();
  const pill = [...$$('.title-bar-brand [data-slot="badge"]')];
  expect(pill.map((el) => [el.textContent, el.classList.contains('bg-accent')]), "T3's small badge, on zinc-100").toEqual([['for T3 Code', true]]);
});

test('clicking the right end\'s buttons never drags the window; the rest of the bar, Refreshed included, does', async () => {
  stubApp({});
  await mountPage();
  expect(titleBar()!.className).toContain('[-webkit-app-region:drag]');
  expect(actions()!.className.split(' ')).toContain('[&_button]:[-webkit-app-region:no-drag]');
  expect(actions()!.className.split(' ')).not.toContain('[-webkit-app-region:no-drag]');
  expect($$('.title-bar-actions button').map((el) => el.textContent || el.getAttribute('aria-label'))).toEqual(['Updates unavailable: Updates work only in the packaged app.', 'Add item', 'Settings']);
});

test('screen readers reach the actions and Refreshed but skip the brand; the page keeps one h1, for screen readers only', async () => {
  stubApp({});
  await mountPage();
  expect(titleBar()!.closest('[aria-hidden="true"]')).toBeNull();
  expect($('.title-bar-brand')!.getAttribute('aria-hidden')).toBe('true');
  expect(actions()!.closest('[aria-hidden="true"]')).toBeNull();
  expect($$('h1')).toHaveLength(1);
  expect($('h1')!.className).toBe('sr-only');
});

test('in a browser, the bar shows without the traffic lights\' gap and holds Refreshed and Add item', async () => {
  await mountPage();
  expect(titleBar()!.className).not.toContain('pl-[89px]');
  expect([...actions()!.children].map((el) => el.textContent)).toEqual(['Refreshed 20m ago', 'Add item']);
  expect($('h1')!.className).toBe('sr-only');
});

test('the title bar also tops the missing-t3 notice, with only Settings at its right end, and Settings opens', async () => {
  stubApp({ listProfiles: vi.fn(async () => ({ profiles: [{ name: '.claude', ticked: true }], installed: true, conflicts: [] })) });
  await mountPage({ ...sample, tools: { t3: { problem: 'missing' } } });
  expect(titleBar()).not.toBeNull();
  expect([...actions()!.children].map((el) => el.textContent)).toEqual(['Settings']);
  await settle(() => $<HTMLButtonElement>('.title-bar .open-settings')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect($('#settings-dialog')!.textContent).toContain('.claude');
});

test('in a browser, the missing-t3 notice\'s bar has nothing at its right end', async () => {
  await mountPage({ ...sample, tools: { t3: { problem: 'missing' } } });
  expect(titleBar()).not.toBeNull();
  expect(actions()!.children).toHaveLength(0);
});
