// The title bar's five counters: need you, building over the in-flight limit, queued, shipped and spend, always for
// the whole factory. Each opens a popover of the items behind its number; picking one opens the item dialog.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, moved, mountPage, sample, settle, text } from '../../test/support.ts';

const counters = () => $$<HTMLButtonElement>('.counters button[aria-haspopup]');
const counter = (label: string) => counters().find((b) => b.getAttribute('aria-label')!.startsWith(`${label}: `))!;
const popup = () => $('[data-slot="popover-popup"][data-open]');
const rows = () => [...popup()!.querySelectorAll('li')].map(text);
/** The popover's head, its title and count, and its foot. */
const head = (pop: HTMLElement) => text(pop.querySelector('.h-10'));
const foot = (pop: HTMLElement) => text(pop.querySelector('.border-t'));
const scopeButton = (platform: string) => $<HTMLButtonElement>(`.list-group[data-platform="${platform}"] button.scope`)!;

async function openCounter(label: string): Promise<HTMLElement> {
  await settle(() => counter(label).click());
  return popup()!;
}

test('the counters show need you, building over the limit of 2, queued, shipped this week and spend', async () => {
  await mountPage();
  expect(counters().map(text)).toEqual(['8need you', '3/2building', '3queued', '4shipped', '$190.25spend']);
  expect(counters().map((b) => b.getAttribute('aria-label'))).toEqual([
    'need you: 8 items only you can move',
    'building: 1 over the in-flight limit',
    'queued: 3 items ready to build, 4 more in List',
    'shipped: Done in the last 7 days',
    'spend: Agent cost on open and recent items, an API estimate',
  ]);
});

test('the counts are the whole factory\'s with a repository scoped', async () => {
  await mountPage();
  const before = counters().map(text);
  await openCounter('need you');
  const items = rows();
  await settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settle(() => scopeButton('Apple').click());
  expect(text($('.title-bar .scope'))).toBe('Apple');
  expect(counters().map(text)).toEqual(before);
  await openCounter('need you');
  expect(rows()).toEqual(items);
});

test('need you lists its items by status, each with its status glyph in its colour', async () => {
  await mountPage();
  const pop = await openCounter('need you');
  expect(head(pop)).toBe('Needs you8');
  expect([...pop.querySelectorAll('h3')].map(text)).toEqual(['Needs you 2', 'Ready 1', 'Verify 4', 'Ready to merge 1']);
  expect(rows()).toEqual([
    '#23 Faster library sync on large collections30m ago',
    '#202 Sign-in screen35m ago',
    '#140 Owner accounts1h ago',
    '#210 Bump FFmpeg to 7.140m ago',
    '#31 New artwork grid layout1h ago',
    '#34 Swipe between episodes2h ago',
    '#147 Fall back to software transcoding when the GPU is busy3h ago',
    '#142 Cache probe results between restarts1h ago',
  ]);
  const glyph = pop.querySelector('li svg') as SVGElement;
  expect(glyph.style.color).toBe('var(--st-amber)');
  const age = [...pop.querySelectorAll('li span')].find((s) => text(s) === '30m ago' && !s.children.length)!;
  expect(age.className.split(' '), 'an age such as "3d ago" stays on one line').toContain('whitespace-nowrap');
  // An auto track grows to the title's full width and pushes the age out of the popover; a shrinkable one truncates the title.
  expect(pop.querySelector('ul')!.className.split(' ')).toContain('grid-cols-[minmax(0,1fr)]');
});

test('building lists the items in progress, its slots and what the limit means', async () => {
  await mountPage();
  const pop = await openCounter('building');
  expect(head(pop)).toBe('Building3/2');
  expect(rows().map((r) => r.split(' ')[0])).toEqual(['#150', '#30', '#180']);
  expect(foot(pop)).toBe('No free slot: queued items wait for one.');
});

test('a concept in progress takes no build slot', async () => {
  await mountPage(moved('I_sample09', 'In progress'));
  expect(text(counter('building'))).toBe('3/2building');
  const pop = await openCounter('building');
  expect(rows().map((r) => r.split(' ')[0])).not.toContain('#200');
  expect(head(pop)).toBe('Building3/2');
});

test('queued lists the queued items and how many wait in List', async () => {
  await mountPage();
  const pop = await openCounter('queued');
  expect(head(pop)).toBe('Queued3');
  expect(rows()).toHaveLength(3);
  expect(foot(pop)).toBe('4 items more in List, not yet queued.');
});

test('shipped lists this week\'s done items, newest first', async () => {
  await mountPage();
  const pop = await openCounter('shipped');
  expect(head(pop)).toBe('Shippedlast 7 days');
  expect(rows().map((r) => r.split(' ')[0])).toEqual(['#5', '#40', '#203', '#181']);
});

test('spend lists the five priciest items with their cost, out of every priced item', async () => {
  await mountPage();
  const pop = await openCounter('spend');
  expect(head(pop)).toBe('Agent spend$190.25');
  expect(rows()).toEqual([
    '#150 Relay for streaming away from home$46.90',
    '#5 Crash when a server goes offline mid-playback$41.20',
    '#40 Resume from the stored position$27.00',
    '#30 Chapter markers in the scrubber$24.18',
    '#181 Store the playback position per device$18.00',
    'and 8 more',
  ]);
  expect(foot(pop)).toBe('Top 5 of 13 priced items.');
});

test('the spend tooltip says the figure is an API estimate', async () => {
  await mountPage();
  await settle(() => counter('spend').focus());
  await settle(() => vi.advanceTimersByTime(1000));
  expect(text($('[data-slot="tooltip-popup"]'))).toBe('Agent cost on open and recent items, an API estimate');
});

test('with nothing on the board each popover says so', async () => {
  await mountPage({ ...sample, items: [] });
  expect(counters().map(text)).toEqual(['0need you', '0/2building', '0queued', '0shipped', '$0.00spend']);
  const empty: [string, string][] = [];
  for (const label of ['need you', 'building', 'queued', 'shipped', 'spend']) {
    const pop = await openCounter(label);
    empty.push([label, text(pop.querySelector('p'))]);
    await settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  }
  expect(empty).toEqual([
    ['need you', 'Desk clear. The line runs without you.'],
    ['building', 'Nothing building right now.'],
    ['queued', 'Nothing queued.'],
    ['shipped', 'Nothing shipped this week.'],
    ['spend', 'No priced agent work yet.'],
  ]);
  expect(counter('building').getAttribute('aria-label')).toBe('building: 2 slots free of 2');
});

test('picking a row closes the popover and opens that item\'s dialog', async () => {
  await mountPage();
  await openCounter('building');
  await settle(() => popup()!.querySelector<HTMLButtonElement>('li button')!.click());
  expect(popup()).toBeNull();
  expect(text($('[data-item-dialog] [data-slot="dialog-title"]'))).toBe('#150 Relay for streaming away from home');
});
