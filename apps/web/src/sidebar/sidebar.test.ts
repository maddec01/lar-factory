// The window controls and the sidebar: the toggle and ⌘B, search with Add item and ⌘N, the List's groups by
// repository with their rows, collapse, "Show N more" and scope, and the foot's Settings and update button.

import { expect, test } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle, stubApp, text } from '../../test/support.ts';
import type { BoardData, Item } from '@mux-factory/shared';

const group = (platform: string) => $(`.list-group[data-platform="${platform}"]`)!;
const rows = (platform: string) => [...group(platform).querySelectorAll<HTMLButtonElement>('button[data-item]')].map((b) => b.dataset.item);
const search = () => $<HTMLInputElement>('.sidebar input[type="search"]')!;
const press = (key: string) => settle(() => dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true })));

async function type(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
  await settle(() => search().dispatchEvent(new Event('input', { bubbles: true })));
}

/** The sample with `count` more List items in the Server repository. */
function withServerList(count: number): BoardData {
  const extra = Array.from({ length: count }, (_, n): Item => ({ ...sample.items[0]!, id: `PVTI_extra${n}`, number: 900 + n, title: `Extra ${n}` }));
  return { ...sample, items: [...sample.items, ...extra] };
}

test('in a browser, grey stand-ins hold the traffic lights\' place, with the sidebar toggle 8 px past them', async () => {
  await mountPage();
  const lights = $$('.traffic-lights > span');
  expect(lights).toHaveLength(3);
  expect(lights.every((s) => s.className.split(' ').includes('bg-(--traffic-stand-in)') && !s.style.background), 'one grey token, no colours').toBe(true);
  const toggle = $<HTMLButtonElement>('.sidebar-toggle')!;
  expect([toggle.getAttribute('aria-label'), toggle.getAttribute('aria-pressed')]).toEqual(['Toggle main sidebar', 'true']);
  expect(toggle.className.split(' ')).toContain('left-19');
});

test('in the Mac app, macOS draws the traffic lights', async () => {
  stubApp({});
  await mountPage();
  expect($('.traffic-lights')).toBeNull();
  expect($('.sidebar-toggle')).not.toBeNull();
});

test('the toggle and ⌘B hide and show the sidebar', async () => {
  await mountPage();
  await settle(() => $<HTMLButtonElement>('.sidebar-toggle')!.click());
  expect($('.sidebar')!.hidden).toBe(true);
  expect($('.sidebar-toggle')!.getAttribute('aria-pressed')).toBe('false');
  await press('b');
  expect($('.sidebar')!.hidden).toBe(false);
  await press('b');
  expect($('.sidebar')!.hidden).toBe(true);
});

test('⌘N opens Add item', async () => {
  await mountPage();
  await press('n');
  expect($('#add-item-dialog')!.hidden).toBe(false);
});

test('a closed sidebar stays mounted: ⌘N still opens Add item, and the search and collapsed groups survive', async () => {
  await mountPage();
  await settle(() => group('Server').querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  await press('b');
  await press('b');
  expect(group('Server').querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false');
  await type('subtitle');
  await press('b');
  await press('n');
  expect($('#add-item-dialog')!.hidden).toBe(false);
  await press('b');
  expect(search().value).toBe('subtitle');
});

test('the sidebar holds the brand, search and Add item, then a group per repository and a Draft group with their List items', async () => {
  await mountPage();
  expect(text($('.sidebar .brand'))).toBe('FactoryforCode');
  expect(search().placeholder).toBe('Search List');
  expect($('.sidebar .add-item')!.getAttribute('aria-label')).toBe('Add item');
  expect($$('.list-group').map((g) => [g.dataset.platform, text(g.querySelector('.count'))])).toEqual([['Server', '2'], ['Apple', '1'], ['Draft', '1']]);
  expect(rows('Server'), 'in board order, as in the prototype').toEqual(['PVTI_sample01', 'PVTI_sample02']);
  expect(text(group('Server').querySelector('button.scope'))).toBe('SServermux-server');
  const row = group('Apple').querySelector('button[data-item]')!;
  expect(text(row)).toBe('#12 Remember the last subtitle language per show19h ago');
  expect(row.querySelector('svg.lucide-circle'), 'the List glyph').not.toBeNull();
});

test('a repository with nothing in List says so', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => i.id !== 'PVTI_sample03') });
  expect(text(group('Apple').querySelector('p'))).toBe('Nothing in List');
  expect(text(group('Apple').querySelector('.count'))).toBe('0');
});

test('a group collapses and expands', async () => {
  await mountPage();
  const chevron = group('Server').querySelector<HTMLButtonElement>('button[aria-expanded]')!;
  expect(chevron.getAttribute('aria-label')).toBe('Collapse Server');
  await settle(() => chevron.click());
  expect(rows('Server')).toEqual([]);
  expect([chevron.getAttribute('aria-label'), chevron.getAttribute('aria-expanded')]).toEqual(['Expand Server', 'false']);
  await settle(() => chevron.click());
  expect(rows('Server')).toHaveLength(2);
});

test('a group shows its first six items, then "Show N more" shows the rest', async () => {
  await mountPage(withServerList(6));
  expect(rows('Server')).toHaveLength(6);
  const more = [...group('Server').querySelectorAll('button')].find((b) => text(b).startsWith('Show'))!;
  expect(text(more)).toBe('Show 2 more');
  await settle(() => more.click());
  expect(rows('Server')).toHaveLength(8);
  expect([...group('Server').querySelectorAll('button')].some((b) => text(b).startsWith('Show'))).toBe(false);
});

test('search filters List items only, opens every group that matches, and clears', async () => {
  await mountPage(withServerList(6));
  await settle(() => group('Server').querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  await type('extra');
  expect($$('.list-group').map((g) => g.dataset.platform), 'groups without a match hide').toEqual(['Server']);
  expect(rows('Server'), 'a collapsed group opens, and shows every match').toHaveLength(6);
  await type('#12');
  expect(rows('Apple')).toEqual(['PVTI_sample03']);
  await type('Run more than one 4K');
  expect(text($('.sidebar nav > p')), 'a Queued item is not in List').toBe('Nothing in List matches.');
  await settle(() => $<HTMLButtonElement>('.sidebar button[aria-label="Clear search"]')!.click());
  expect(search().value).toBe('');
  expect($$('.list-group')).toHaveLength(3);
});

test('a group\'s name scopes the main area to its repository; pressing it again shows the whole factory', async () => {
  await mountPage();
  const scope = group('Apple').querySelector<HTMLButtonElement>('button.scope')!;
  await settle(() => scope.click());
  expect(scope.getAttribute('aria-pressed')).toBe('true');
  expect($$('.desk-card').map((c) => c.dataset.item)).toEqual(['PVTI_sample11', 'PVTI_sample16']);
  await settle(() => scope.click());
  expect(scope.getAttribute('aria-pressed')).toBe('false');
  expect($$('.desk-card')).toHaveLength(4);
});

test('a row opens the item dialog and stays marked while it shows', async () => {
  await mountPage();
  const row = () => group('Server').querySelector<HTMLButtonElement>('[data-item="PVTI_sample02"]')!;
  await settle(() => row().click());
  expect($('[data-item-dialog]')!.textContent).toContain('Verify VideoToolbox');
  expect(row().className).toContain('bg-(--sidebar-row-selected)');
});

test('in the app the foot holds Settings and the update button', async () => {
  stubApp({});
  await mountPage();
  expect($('.sidebar-foot .open-settings')!.getAttribute('aria-label')).toBe('Settings');
  expect($('.sidebar-foot .update-button')).not.toBeNull();
});

test('in a browser the foot holds a still stand-in for the update button', async () => {
  await mountPage();
  expect($('.sidebar-foot .open-settings')).toBeNull();
  const standIn = $('.sidebar-foot .update-stand-in')!;
  expect([standIn.getAttribute('aria-label'), standIn.getAttribute('aria-disabled')]).toEqual(['Check for updates', 'true']);
});
