// The main area's title bar, in the Mac app and in a browser: the scope, the Refreshed time, the counters and This
// week, past the window controls while the sidebar is closed.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle, stubApp, text } from '../../test/support.ts';

const titleBar = () => $<HTMLElement>('.title-bar')!;
const scopeButton = (platform: string) => $<HTMLButtonElement>(`.list-group[data-platform="${platform}"] button.scope`)!;

test('the title bar shows the whole factory, when the data was read, and This week, not built yet', async () => {
  await mountPage();
  expect(text(titleBar().querySelector('.scope'))).toBe('Whole factory');
  expect(text(titleBar().querySelector('.refreshed'))).toBe('refreshed 20m ago');
  const week = [...titleBar().querySelectorAll('button')].find((b) => text(b) === 'This week')!;
  expect([week.disabled, week.title]).toEqual([true, "This week isn't built yet"]);
  expect(titleBar().className.split(' ')).toContain('h-13');
});

test('a group\'s name scopes the title bar to its repository, and the × clears it', async () => {
  await mountPage();
  await settle(() => scopeButton('Apple').click());
  expect(text(titleBar().querySelector('.scope'))).toBe('Apple');
  const clear = titleBar().querySelector<HTMLButtonElement>('button[aria-label="Show the whole factory"]')!;
  await settle(() => clear.click());
  expect(text(titleBar().querySelector('.scope'))).toBe('Whole factory');
  expect(titleBar().querySelector('button[aria-label="Show the whole factory"]')).toBeNull();
});

test('the bar drags the window, but its buttons never do', async () => {
  await mountPage();
  await settle(() => scopeButton('Server').click());
  expect(titleBar().className.split(' ')).toContain('[-webkit-app-region:drag]');
  const clear = titleBar().querySelector('button[aria-label="Show the whole factory"]')!;
  expect(clear.className.split(' ')).toContain('[-webkit-app-region:no-drag]');
  const week = [...titleBar().querySelectorAll('button')].find((b) => text(b) === 'This week')!;
  expect(week.closest('.\\[-webkit-app-region\\:no-drag\\]')).not.toBeNull();
});

test('the bar starts past the window controls while the sidebar is closed', async () => {
  await mountPage();
  expect(titleBar().className.split(' ')).toContain('pl-4');
  await settle(() => $<HTMLButtonElement>('.sidebar-toggle')!.click());
  expect($('.sidebar')!.hidden).toBe(true);
  expect(titleBar().className.split(' ')).toContain('pl-27.5');
});

test('screen readers skip the brand; the page keeps one h1, for screen readers only', async () => {
  await mountPage();
  expect($('.brand')!.getAttribute('aria-hidden')).toBe('true');
  expect(titleBar().closest('[aria-hidden="true"]')).toBeNull();
  expect($$('h1').map((h) => [h.className, text(h)])).toEqual([['sr-only', 'µx Factory']]);
});

test('refreshed counts up each second, between the board\'s 15 s ticks, and says when nothing was read yet', async () => {
  await mountPage({ ...sample, fetchedAt: new Date(Date.now()).toISOString() });
  await settle(() => vi.advanceTimersByTime(12_000));
  expect(text($('.refreshed'))).toBe('refreshed 12s ago');
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(text($('.refreshed'))).toBe('refreshed 13s ago');
});

test('before the first read it says so', async () => {
  await mountPage({ ...sample, fetchedAt: null });
  expect(text($('.refreshed'))).toBe('not read yet');
});

test('above the missing-t3 notice the bar is empty, and the sidebar keeps the brand and Settings, which opens', async () => {
  stubApp({ listProfiles: vi.fn(async () => ({ profiles: [{ name: '.claude', ticked: true }], installed: true, conflicts: [] })) });
  await mountPage({ ...sample, tools: { t3: { problem: 'missing' } } });
  expect(titleBar().children).toHaveLength(0);
  expect($('.sidebar .brand')).not.toBeNull();
  expect($('.sidebar input[type="search"]'), 'no List to search').toBeNull();
  expect($('.sidebar .add-item')).toBeNull();
  expect($$('.sidebar-foot button').map((b) => b.getAttribute('aria-label'))).toEqual(['Settings']);
  await settle(() => $<HTMLButtonElement>('.sidebar .open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Skills')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect($('.tool-missing')!.closest('[hidden]'), 'Settings takes the notice\'s place').not.toBeNull();
  expect($('.settings-body')!.textContent).toContain('~/.claude');
});

test('in a browser, the missing-t3 notice\'s sidebar foot holds only Settings', async () => {
  await mountPage({ ...sample, tools: { t3: { problem: 'missing' } } });
  expect($$('.sidebar-foot button').map((b) => b.getAttribute('aria-label'))).toEqual(['Settings']);
});
