// The main area's title bar, in the Mac app and in a browser: the scope menu, the Refreshed time, the counters and
// This week, past the window controls while the sidebar is closed.

import { expect, test, vi } from 'vite-plus/test';
import { clock } from '@mux-factory/shared';
import { $, $$, NOW, fullScreen, mountPage, push, sample, settle, stubApp, text } from '../../test/support.ts';

const titleBar = () => $<HTMLElement>('.title-bar')!;
const scopeButton = (platform: string) => $<HTMLButtonElement>(`.list-group[data-platform="${platform}"] button.scope`)!;
const trigger = () => titleBar().querySelector<HTMLButtonElement>('button.scope')!;
const refreshed = () => titleBar().querySelector<HTMLElement>('.refreshed')!;
const dot = () => refreshed().querySelector<HTMLElement>('[data-dot]')!;
const ping = () => refreshed().querySelector('[data-ping]');
const menu = () => $('[role="menu"]');
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const fresh = (ago = 0) => ({ ...sample, error: null, fetchedAt: new Date(NOW - ago).toISOString() });
const isAmber = (el: Element) => el.classList.contains('bg-amber-500');
const isGreen = (el: Element) => el.classList.contains('bg-success');
const tooltip = async () => {
  await settle(() => refreshed().focus());
  await settle(() => vi.advanceTimersByTime(1000));
  return $$('[data-slot="tooltip-popup"] [data-line]').map(text);
};

test('the title bar shows All repositories, when the data was last read, and This week, not built yet', async () => {
  await mountPage();
  expect(text(trigger())).toBe('All repositories');
  expect(trigger().querySelector('svg')).not.toBeNull();
  expect(trigger().getAttribute('aria-label')).toBe('Scope: All repositories');
  expect(text(refreshed())).toBe('Stale · 20m ago');
  const week = [...titleBar().querySelectorAll('button')].find((b) => text(b) === 'This week')!;
  expect([week.disabled, week.title]).toEqual([true, "This week isn't built yet"]);
  expect(titleBar().className.split(' ')).toContain('h-13');
});

test('a group\'s name scopes the title bar to its platform, and its name again clears it', async () => {
  await mountPage();
  await settle(() => scopeButton('Apple').click());
  expect(text(trigger())).toBe('Apple');
  await settle(() => scopeButton('Apple').click());
  expect(text(trigger())).toBe('All repositories');
  expect(titleBar().querySelector('button[aria-label="Show the whole factory"]'), 'the × is gone').toBeNull();
});

test('the scope menu is headed Show, then All repositories, a separator and a platform per sidebar group, checked at the scope', async () => {
  await mountPage();
  expect(menu()).toBeNull();
  await settle(() => trigger().click());
  expect(text($('[role="menu"] [data-slot="menu-label"]'))).toBe('Show');
  expect(entries().map(text)).toEqual(['All repositories', 'Server', 'Apple', 'Draft']);
  expect(entries().map((e) => e.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
  expect($('[role="menu"] [role="separator"]')).not.toBeNull();
  expect(entries()[1]!.querySelector('.plat-server')).not.toBeNull();
  expect(entries()[2]!.querySelector('.plat-apple')).not.toBeNull();
  expect(entries()[3]!.querySelector('.plat-draft')).not.toBeNull();
  expect(entries()[0]!.querySelector('[class*="plat-"]'), 'All repositories has no dot').toBeNull();
});

test('picking a platform sets the scope, closes the menu and marks the sidebar group; All repositories clears it', async () => {
  await mountPage();
  await settle(() => trigger().click());
  await settle(() => entries()[2]!.click());
  expect(text(trigger())).toBe('Apple');
  expect(menu()).toBeNull();
  expect(scopeButton('Apple').getAttribute('aria-pressed')).toBe('true');
  await settle(() => trigger().click());
  expect(entries().map((e) => e.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
  await settle(() => entries()[0]!.click());
  expect(text(trigger())).toBe('All repositories');
  expect(menu()).toBeNull();
  expect(scopeButton('Apple').getAttribute('aria-pressed')).toBe('false');
});

test('the menu works from the keyboard', async () => {
  await mountPage();
  trigger().focus();
  await settle(() => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(entries()).toHaveLength(4);
  await settle(() => entries()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(text(trigger())).toBe('Server');
});

test('the bar drags the window, but its buttons and the time never do', async () => {
  await mountPage();
  expect(titleBar().className.split(' ')).toContain('[-webkit-app-region:drag]');
  expect(trigger().className.split(' ')).toContain('[-webkit-app-region:no-drag]');
  expect(refreshed().className.split(' ')).toContain('[-webkit-app-region:no-drag]');
  const week = [...titleBar().querySelectorAll('button')].find((b) => text(b) === 'This week')!;
  expect(week.closest('.\\[-webkit-app-region\\:no-drag\\]')).not.toBeNull();
});

test('the scope trigger and the time show a focus ring on keyboard focus', async () => {
  await mountPage();
  expect(trigger().className.split(' ')).toContain('focus-visible:ring-2');
  expect(refreshed().className.split(' ')).toContain('focus-visible:ring-2');
  expect(refreshed().tabIndex).toBe(0);
});

test('the bar starts past the window controls while the sidebar is closed', async () => {
  await mountPage();
  expect(titleBar().className.split(' ')).toContain('pl-4');
  await settle(() => $<HTMLButtonElement>('.sidebar-toggle')!.click());
  expect($('.sidebar')!.hidden).toBe(true);
  expect(titleBar().className.split(' ')).toContain('pl-27.5');
});

test('in the Mac app\'s full screen, the bar of a closed sidebar starts 6 px past the toggle, and moves back on leaving', async () => {
  const window = fullScreen(true);
  stubApp(window.bridge);
  await mountPage();
  await settle(() => $<HTMLButtonElement>('.sidebar-toggle')!.click());
  expect(titleBar().className.split(' ')).toContain('pl-11.5');
  await window.set(false);
  expect(titleBar().className.split(' ')).toContain('pl-27.5');
});

test('screen readers skip the brand; the page keeps one h1, for screen readers only', async () => {
  await mountPage();
  expect($('.brand')!.getAttribute('aria-hidden')).toBe('true');
  expect(titleBar().closest('[aria-hidden="true"]')).toBeNull();
  expect($$('h1').map((h) => [h.className, text(h)])).toEqual([['sr-only', 'µx Factory']]);
});

test('the time counts up each second, between the board\'s 15 s ticks, in muted 12 px digits of fixed width', async () => {
  await mountPage(fresh());
  await settle(() => vi.advanceTimersByTime(12_000));
  expect(text(refreshed())).toBe('12s ago');
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(text(refreshed())).toBe('13s ago');
  expect(refreshed().className.split(' ')).toEqual(expect.arrayContaining(['text-xs', 'tabular-nums', 'text-(--muted-foreground)']));
});

test('a fresh board has a green dot; stale turns the dot amber and says Stale, with the text still muted', async () => {
  await mountPage(fresh());
  expect(isGreen(dot())).toBe(true);
  expect(text(refreshed())).toBe('0s ago');
  await push({ ...fresh(4 * 86_400_000), error: null });
  expect(text(refreshed())).toBe('Stale · 4d ago');
  expect(isAmber(dot())).toBe(true);
  expect(refreshed().className.split(' ')).toContain('text-(--muted-foreground)');
  await push(fresh(20 * 60_000 + 1));
  expect(text(refreshed()), 'no error, but not read for 3 intervals').toBe('Stale · 20m ago');
});

test('a failed read turns the dot amber too, and the sample\'s old failed read says Stale', async () => {
  await mountPage();
  expect([text(refreshed()), isAmber(dot())]).toEqual(['Stale · 20m ago', true]);
  await push({ ...fresh(), error: 'gh api graphql failed' });
  expect([text(refreshed()), isAmber(dot())]).toEqual(['Stale · 0s ago', true]);
});

test('before the first read it says so behind a grey dot, or an amber one if that read failed', async () => {
  await mountPage({ ...sample, fetchedAt: null, error: null });
  expect(text(refreshed())).toBe('Not read yet');
  expect([isAmber(dot()), isGreen(dot())]).toEqual([false, false]);
  await push({ ...sample, fetchedAt: null, error: 'gh api graphql failed' });
  expect(text(refreshed())).toBe('Not read yet');
  expect(isAmber(dot())).toBe(true);
});

test('the tooltip gives the exact time and when reads happen', async () => {
  await mountPage(fresh(11_000));
  const read = clock(new Date(NOW - 11_000).toISOString(), undefined);
  expect(read).toMatch(/^\d\d:\d\d$/);
  expect(await tooltip()).toEqual([`Updated 12s ago · ${read}`, 'Reads every 45s']);
});

test('the tooltip names a failed read by its first line', async () => {
  await mountPage();
  const read = clock(sample.fetchedAt!, undefined);
  expect(await tooltip()).toEqual([`Updated 20m ago · ${read}`, 'Last read failed: gh api graphql failed: error connecting to api.github.com']);
});

test('before the first read the tooltip says so', async () => {
  await mountPage({ ...sample, fetchedAt: null, error: null });
  expect(await tooltip()).toEqual(['Not read yet', 'Reads every 45s']);
  await push({ ...sample, fetchedAt: null, error: 'boom\nmore' });
  expect(await tooltip()).toEqual(['Not read yet', 'Last read failed: boom']);
});

test('the dot pings once for each newer read, never on page load, in stale or when older data arrives', async () => {
  await mountPage(fresh(10_000));
  expect(ping(), 'not on page load').toBeNull();
  await settle(() => vi.advanceTimersByTime(5_000));
  expect(ping()).toBeNull();
  await push(fresh(0));
  const first = ping();
  expect(first).not.toBeNull();
  expect(first!.className.split(' ')).toEqual(expect.arrayContaining(['motion-safe:animate-[refreshed-ping_1.2s_ease-out_forwards]']));
  await push(fresh(0));
  expect(ping(), 'the same read again does not replay it').toBe(first);
  await settle(() => vi.advanceTimersByTime(2_000));
  await push(fresh(1_000));
  expect(ping(), 'an older read does not ping').toBe(first);
  await settle(() => vi.advanceTimersByTime(3_000));
  await push({ ...fresh(-5_000), items: [] });
  expect(ping(), 'a newer read replays it').not.toBe(first);
});

test('the first read of a page that had none pings, a failed read does not', async () => {
  await mountPage({ ...sample, fetchedAt: null, error: null });
  await push(fresh(0));
  expect(ping(), 'a first read is newer than none').not.toBeNull();
  await push({ ...fresh(0), error: 'boom' });
  expect(ping()).toBeNull();
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
