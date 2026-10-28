// The board's title bar, in the board app and in a browser: on the left the brand, the scope menu and the Refreshed
// time; on the right the counters, the List button, Add item, the "for T3 Code" tag, the update pill while there's an
// update, and Settings, past the traffic lights; above the missing-t3 notice only the brand and Settings.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { clock } from '@lar-factory/shared';
import { $, $$, NOW, fullScreen, mountPage, pressMenu, push, sample, settle, stubApp, text, toolChecks, updatesOff } from '../../test/support.ts';

// jsdom has no ResizeObserver, which the copied Modal's scroll fade observes with.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));

const titleBar = () => $<HTMLElement>('.title-bar')!;
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
  // Radix repeats the tooltip, hidden, as the trigger's description; this reads the one shown.
  return $$('[data-radix-popper-content-wrapper] [data-line]').filter((line) => !line.closest('[role="tooltip"]')).map(text);
};

/** The title bar's controls, left to right, by name. */
const CONTROLS = {
  brand: '.brand', scope: 'button.scope', refreshed: '.refreshed', counters: '.counters', list: '.list-button',
  'add item': '.add-item', 't3 tag': '.t3-tag', update: '.update-button', settings: '.open-settings',
} as const;
const controls = () => [...titleBar().querySelectorAll(Object.values(CONTROLS).join(', '))]
  .map((el) => Object.entries(CONTROLS).find(([, selector]) => el.matches(selector))![0]);
const inset = () => titleBar().className.split(' ').includes('pl-[74px]');

test('the title bar holds the brand, Scope and Refreshed on the left, then the counters, List, Add item, the T3 tag, the update pill and Settings on the right', async () => {
  stubApp({ getUpdateState: vi.fn(async () => ({ ...updatesOff, enabled: true, status: 'available' as const, availableVersion: '1.1.0', message: null })) });
  await mountPage();
  expect(controls()).toEqual(['brand', 'scope', 'refreshed', 'counters', 'list', 'add item', 't3 tag', 'update', 'settings']);
  const header = titleBar().querySelector('header')!;
  const [, , left, right] = [...header.children];
  expect(left!.contains(refreshed()) && !left!.querySelector('.counters'), 'the left holds Scope and Refreshed, not the counters').toBe(true);
  expect(right!.firstElementChild!.matches('.counters'), 'the counters open the right, before List').toBe(true);
  expect(text(titleBar().querySelector('.t3-tag'))).toBe('for T3 Code');
  expect(header.className.split(' ')).toContain('h-13');
});

// jsdom lays nothing out, so this checks the classes: every control is 28 px tall, an icon-only one 28 px square.
test('every control in the title bar is 28 px tall', async () => {
  stubApp({ getUpdateState: vi.fn(async () => ({ ...updatesOff, enabled: true, status: 'available' as const, availableVersion: '1.1.0', message: null })) });
  await mountPage();
  const classes = (el: Element) => el.className.split(' ');
  for (const el of titleBar().querySelectorAll('button.scope, .refreshed, .counters button, .list-button, .add-item, .t3-tag, .update-button')) {
    expect(classes(el), el.className).toContain('h-7');
    if (el.matches('button')) expect(classes(el), 'the copied Button sets its height again from sm').toContain('sm:h-7');
  }
  expect(classes(titleBar().querySelector('.open-settings')!)).toContain('size-7');
});

test('in a browser, where nothing updates, there\'s no update pill', async () => {
  await mountPage();
  expect(controls()).toEqual(['brand', 'scope', 'refreshed', 'counters', 'list', 'add item', 't3 tag', 'settings']);
});

test('the brand reads "lar Factory": the copied BrandMark, then Factory on its baseline', async () => {
  await mountPage();
  const brand = $('.title-bar .brand')!;
  expect(text(brand)).toBe('larFactory');
  expect(brand.className.split(' ')).toEqual(expect.arrayContaining(['inline-flex', 'items-baseline']));
  const [mark, factory] = [...brand.children];
  expect(mark!.className.split(' ')).toContain('lar-brand-mark');
  expect(mark!.querySelector('svg')).not.toBeNull();
  expect(text(factory)).toBe('Factory');
});

test('above the missing-t3 notice the bar holds only the brand and Settings, which opens', async () => {
  stubApp({ listProfiles: vi.fn(async () => ({ profiles: [{ name: '.claude', ticked: true }], installed: true, conflicts: [] })) });
  await mountPage({ ...sample, tools: toolChecks({ t3: { result: 'missing' } }) });
  expect(controls()).toEqual(['brand', 'settings']);
  await settle(() => $<HTMLButtonElement>('.title-bar .open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Skills')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect($('[role="dialog"] .settings-body')!.textContent, 'Settings opens over the notice').toContain('~/.claude');
  expect($('.tool-missing')).not.toBeNull();
});

test('in a browser too, the missing-t3 notice\'s bar holds only the brand and Settings', async () => {
  await mountPage({ ...sample, tools: toolChecks({ t3: { result: 'missing' } }) });
  expect(controls()).toEqual(['brand', 'settings']);
});

test('Add item opens the Add item flow, and ⌘N does too', async () => {
  await mountPage();
  const add = titleBar().querySelector<HTMLButtonElement>('.add-item')!;
  expect([text(add), add.getAttribute('aria-keyshortcuts')]).toEqual(['Add item', 'Meta+N']);
  await settle(() => add.click());
  expect($('#add-item-dialog')!.hidden).toBe(false);
});

test('in a browser, grey stand-ins hold the traffic lights\' place, with the bar starting past them as in the Mac app', async () => {
  await mountPage();
  const lights = $$('.traffic-lights > span');
  expect(lights).toHaveLength(3);
  expect(lights.every((s) => s.className.split(' ').includes('bg-(--traffic-stand-in)') && !s.style.background), 'one grey token, no colours').toBe(true);
  expect(inset()).toBe(true);
});

test('in the Mac app, macOS draws the traffic lights and the bar starts past them', async () => {
  stubApp({});
  await mountPage();
  expect($('.traffic-lights')).toBeNull();
  expect(inset()).toBe(true);
});

test('in the Mac app\'s full screen, where macOS hides the traffic lights, the bar keeps only its own padding', async () => {
  const window = fullScreen(true);
  stubApp(window.bridge);
  await mountPage();
  expect(inset()).toBe(false);
  await window.set(false);
  expect(inset()).toBe(true);
  await window.set(true);
  expect(inset()).toBe(false);
});

test('outside the Mac app, full screen leaves the bar where it is', async () => {
  stubApp({ ...fullScreen(true).bridge, platform: 'linux' });
  await mountPage();
  expect(inset()).toBe(true);
});

test('the bar drags the window, but none of its controls do', async () => {
  await mountPage();
  expect(titleBar().className.split(' ')).toEqual(expect.arrayContaining([
    '[-webkit-app-region:drag]', '[&_:is(button,a,[tabindex])]:[-webkit-app-region:no-drag]',
  ]));
  expect(refreshed().tabIndex, 'the time is a tab stop, so it is no-drag too').toBe(0);
});

test('screen readers skip the brand; the page keeps one h1, for screen readers only', async () => {
  await mountPage();
  expect($('.brand')!.getAttribute('aria-hidden')).toBe('true');
  expect(titleBar().closest('[aria-hidden="true"]')).toBeNull();
  expect($$('h1').map((h) => [h.className, text(h)])).toEqual([['sr-only', 'Lar Factory']]);
});

test('the title bar shows All repositories and when the data was last read', async () => {
  await mountPage();
  expect(text(trigger())).toBe('All repositories');
  expect(trigger().querySelector('svg')).not.toBeNull();
  expect(trigger().getAttribute('aria-label')).toBe('Scope: All repositories');
  expect(text(refreshed())).toBe('Stale · 20m ago');
});

test('the scope menu is headed Show, then All repositories, a separator and a repository per List group, checked at the scope', async () => {
  await mountPage();
  expect(menu()).toBeNull();
  await pressMenu(trigger());
  expect(text($('[role="menu"] [role="menuitemradio"]')!.parentElement!.previousElementSibling)).toBe('Show');
  expect(entries().map(text)).toEqual(['All repositories', 'lar-server', 'lar-apple', 'Draft']);
  expect(entries().map((e) => e.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false']);
  expect($('[role="menu"] [role="separator"]')).not.toBeNull();
  expect(entries()[1]!.querySelector('.repo-tone-0')).not.toBeNull();
  expect(entries()[2]!.querySelector('.repo-tone-1')).not.toBeNull();
  expect(entries()[3]!.querySelector('.repo-tone-none')).not.toBeNull();
  expect(entries()[0]!.querySelector('[class*="repo-tone-"]'), 'All repositories has no dot').toBeNull();
});

test('picking a repository sets the scope and closes the menu; All repositories clears it', async () => {
  await mountPage();
  await pressMenu(trigger());
  await settle(() => entries()[2]!.click());
  expect(text(trigger())).toBe('lar-apple');
  expect(menu()).toBeNull();
  await pressMenu(trigger());
  expect(entries().map((e) => e.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false']);
  await settle(() => entries()[0]!.click());
  expect(text(trigger())).toBe('All repositories');
  expect(menu()).toBeNull();
});

test('the List modal\'s Scope board scopes the title bar too', async () => {
  await mountPage();
  await settle(() => $<HTMLButtonElement>('.title-bar .list-button')!.click());
  await settle(() => $$<HTMLButtonElement>('[data-list-modal] nav button').find((b) => b.querySelector('.name')?.textContent === 'lar-apple')!.click());
  await settle(() => $<HTMLButtonElement>('[data-list-modal] .scope-board')!.click());
  expect(text(trigger())).toBe('lar-apple');
});

test('the menu works from the keyboard', async () => {
  await mountPage();
  trigger().focus();
  await settle(() => trigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
  expect(entries()).toHaveLength(4);
  await settle(() => entries()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(text(trigger())).toBe('lar-server');
});

test('the time shows a focus ring on keyboard focus', async () => {
  await mountPage();
  expect(refreshed().className.split(' ')).toContain('focus-visible:ring-2');
  expect(refreshed().tabIndex).toBe(0);
});

test('the time counts up each second, between the board\'s 15 s ticks, in muted 12 px digits of fixed width', async () => {
  await mountPage(fresh());
  await settle(() => vi.advanceTimersByTime(12_000));
  expect(text(refreshed())).toBe('12s ago');
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(text(refreshed())).toBe('13s ago');
  expect(refreshed().className.split(' ')).toEqual(expect.arrayContaining(['text-xs', 'tabular-nums', 'text-base-700']));
});

test('a fresh board has a green dot; stale turns the dot amber and says Stale, with the text still muted', async () => {
  await mountPage(fresh());
  expect(isGreen(dot())).toBe(true);
  expect(text(refreshed())).toBe('0s ago');
  await push({ ...fresh(4 * 86_400_000), error: null });
  expect(text(refreshed())).toBe('Stale · 4d ago');
  expect(isAmber(dot())).toBe(true);
  expect(refreshed().className.split(' ')).toContain('text-base-700');
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

test('while some repositories still read, it names them behind a grey dot, never Stale, until every read lands', async () => {
  const reading = (waiting: string[]) => ({ ...fresh(), firstRead: { step: 'items' as const, running: [], waiting, settled: false } });
  await mountPage(reading(['maddec01/lar-server', 'maddec01/lar-apple']));
  expect(text(refreshed())).toBe('Reading lar-server and lar-apple');
  expect([isAmber(dot()), isGreen(dot())]).toEqual([false, false]);
  await push(reading(['maddec01/lar-apple']));
  expect(text(refreshed())).toBe('Reading lar-apple');
  await push({ ...fresh(), firstRead: { step: 'finishing', running: [], settled: true } });
  expect(text(refreshed())).toBe('0s ago');
  expect(isGreen(dot())).toBe(true);
});

test('the tooltip gives the exact time and when reads happen', async () => {
  await mountPage(fresh(11_000));
  const read = clock(new Date(NOW - 11_000).toISOString(), undefined);
  expect(read).toMatch(/^\d\d:\d\d$/);
  expect(await tooltip()).toEqual([`Updated 12s ago · ${read}`, 'Checks GitHub for changes every 5s, reads everything every 45s']);
});

test('the tooltip names a failed read by its first line', async () => {
  await mountPage();
  const read = clock(sample.fetchedAt!, undefined);
  expect(await tooltip()).toEqual([`Updated 20m ago · ${read}`, 'Last read failed: gh api graphql failed: error connecting to api.github.com']);
});

test('before the first read the tooltip says so', async () => {
  await mountPage({ ...sample, fetchedAt: null, error: null });
  expect(await tooltip()).toEqual(['Not read yet', 'Checks GitHub for changes every 5s, reads everything every 45s']);
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

// jsdom lays nothing out, so this checks the classes behind the fold. Beside the update pill the List and Add item
// labels and the T3 tag come back at 74rem instead of 70rem, since the pill takes the room Scope needs. The counters
// never show their labels.
test('the bar folds by its own width instead of squeezing: the counters keep theirs, and labels go before controls', async () => {
  stubApp({ getUpdateState: vi.fn(async () => ({ ...updatesOff, enabled: true, status: 'downloaded' as const, availableVersion: '1.1.0', downloadedVersion: '1.1.0', message: null })) });
  await mountPage();
  const classes = (el: Element | null) => el!.className.split(' ');
  expect(classes(titleBar().querySelector('header')), 'the copied TitleBar is the container the fold reads').toContain('@container');
  const counters = titleBar().querySelector('.counters')!;
  expect(classes(counters)).toContain('shrink-0');
  expect(classes(counters), 'a size container would have no width of its own').not.toContain('@container');
  expect(classes(counters.parentElement), 'its slot never shrinks below it').not.toContain('min-w-0');
  expect(classes(titleBar().querySelector('.t3-tag'))).toContain('@max-[70rem]:hidden');
  expect(classes(titleBar().querySelector('.t3-tag'))).toContain('[.title-bar:has(.update-button)_&]:@max-[74rem]:hidden');
  for (const [button, label] of [['.list-button', 'List'], ['.add-item', 'Add item']] as const) {
    const span = [...titleBar().querySelectorAll(`${button} span`)].find((s) => text(s) === label);
    expect(classes(span ?? null), `${label}'s label stays for screen readers`).toContain('@max-[70rem]:sr-only');
    expect(classes(span ?? null), `beside the update pill ${label}'s label folds sooner`).toContain('[.title-bar:has(.update-button)_&]:@max-[74rem]:sr-only');
  }
  expect(text(counters), 'the counters show no labels').not.toMatch(/need you|building|queued|shipped|spend/);
  expect(classes(trigger())).toContain('min-w-0');
  expect(classes(trigger().querySelector('.truncate')), 'Scope truncates').toContain('min-w-0');
  expect(classes(refreshed().querySelector('time')!.parentElement)).toContain('@max-[48rem]:sr-only');
});
