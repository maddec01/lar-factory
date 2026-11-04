// The title bar's five counters: need you, building against the build limit, queued, shipped and spend, always for
// the whole factory. Each opens a popover of the items behind its number; picking one opens the item dialog.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, moved, mountPage, sample, settle, text, textBesideIcon } from '../../test/support.ts';
import type { BoardData, ItemThread } from '@lar-factory/shared';

/** The sample with a build limit of 2, which sample mode leaves out. */
const limited = { ...sample, buildLimit: { limit: 'automatic' as const, automatic: 2 } };
const completeSample = { ...limited, error: null, items: sample.items.map(item => ({ ...item, stats: item.stats && item.stats !== 'unavailable' ? item.stats : { agentMs: 0, tokens: 0, costUsd: 0 } })) };

const counters = () => $$<HTMLButtonElement>('.counters button[aria-haspopup]');
const counter = (label: string) => counters().find((b) => b.getAttribute('aria-label')!.startsWith(`${label}: `))!;
const popup = () => $('[data-state="open"] .counter-popup');
const rows = () => [...popup()!.querySelectorAll('li')].map(textBesideIcon);
/** The popover's head, its title and count, and its foot. */
const head = (pop: HTMLElement) => text(pop.querySelector('.h-10'));
const foot = (pop: HTMLElement) => text(pop.querySelector('.border-t'));

async function openCounter(label: string): Promise<HTMLElement> {
  await settle(() => counter(label).click());
  return popup()!;
}

test('the counters show need you, building over the limit of 2, queued, shipped this week and spend, each by its number and named by its label', async () => {
  await mountPage(completeSample);
  expect(counters().map(text)).toEqual(['7', '4/2', '3', '4', '$190.25']);
  expect(counters().map((b) => b.getAttribute('aria-label'))).toEqual([
    'need you: 7 items waiting on your answer, verification or merge',
    'building: 2 over the build limit',
    'queued: 3 items ready to shape, 4 more in List',
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
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect(text($('.title-bar .scope'))).toBe('lar-apple');
  expect(counters().map(text)).toEqual(before);
  await openCounter('need you');
  expect(rows()).toEqual(items);
});

test('need you leaves out a Verify item while its build thread runs, and counts it again when it stops', async () => {
  const fresh = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
  const verify = (state: ItemThread['state'], currentRunning?: true) => ({ ...fresh, items: fresh.items.map((i) => (i.id === 'I_sample10' ? { ...i, status: 'Verify' as const,
    threads: [{ id: 'build', title: 'Build', purpose: 'build', state, currentRunning, updated: '2026-10-21T09:00:00.000Z' } as ItemThread] } : i)) });
  const count = () => Number(/need you: (\d+)/.exec(counter('need you').getAttribute('aria-label')!)![1]);
  await mountPage(verify('done'));
  const waiting = count();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(verify('running', true)));
  expect(count()).toBe(waiting - 1);
  await settle(() => useBoardStore.getState().receive(verify('done')));
  expect(count()).toBe(waiting);
});

test('a counter row shows its repository\'s project icon, not a tone dot', async () => {
  await mountPage({ ...sample, projectIcons: { 'maddec01/lar-server': { kind: 'emoji', emoji: '🚀' } } });
  const pop = await openCounter('need you');
  const icons = [...pop.querySelectorAll('li')].map((li) => li.querySelector('[data-project-icon]'));
  expect(icons.every(Boolean)).toBe(true);
  expect(icons.map(text)).toContain('🚀');
  expect(pop.querySelector('li [class*="repo-tone"].rounded-full')).toBeNull();
});

test('need you lists its items by status, each with its status glyph in its colour', async () => {
  await mountPage();
  const pop = await openCounter('need you');
  expect(head(pop)).toBe('Needs you7');
  expect([...pop.querySelectorAll('h3')].map(text)).toEqual(['Needs you 2', 'Verify 4', 'Ready to merge 1']);
  expect(rows()).toEqual([
    '#23 Faster library sync on large collections30m ago',
    '#202 Sign-in screen35m ago',
    '#900026 Bump FFmpeg to 7.140m ago',
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

test('building lists the builds at work, the build limit and what it means', async () => {
  await mountPage(limited);
  const pop = await openCounter('building');
  expect(head(pop)).toBe('Building4/2');
  expect(rows().map((r) => r.split(' ')[0]), 'Review counts; Verify and Ready to merge only when at work again').toEqual(['#150', '#30', '#180', '#141']);
  expect(foot(pop)).toBe('At the build limit. Start build and Start after still go ahead.');
  expect(text(pop)).not.toContain('slot');
});

test('a build counts while its start is in flight or in Review, and the count shows the excess', async () => {
  const started = { ...limited, buildLimit: { limit: 1, automatic: 2 }, startProgress: { I_sample13: { build: { phase: 'starting' as const } } } };
  await mountPage(moved('I_sample14', 'Review', started));
  expect(text(counter('building'))).toBe('5/1');
  expect(counter('building').getAttribute('aria-label')).toBe('building: 4 over the build limit');
});

test('without a build limit, as in sample mode, building shows only its count', async () => {
  await mountPage();
  expect(text(counter('building'))).toBe('4');
  expect(counter('building').getAttribute('aria-label')).toBe('building: 4 builds at work');
  const pop = await openCounter('building');
  expect([head(pop), pop.querySelector('.border-t')]).toEqual(['Building4', null]);
});

test('a concept in progress is no build at work', async () => {
  await mountPage(moved('I_sample09', 'In progress', limited));
  expect(text(counter('building'))).toBe('4/2');
  const pop = await openCounter('building');
  expect(rows().map((r) => r.split(' ')[0])).not.toContain('#200');
  expect(head(pop)).toBe('Building4/2');
});

test('queued lists the queued items and how many wait in List', async () => {
  await mountPage();
  const pop = await openCounter('queued');
  expect(head(pop)).toBe('Queued3');
  expect(rows()).toHaveLength(3);
  expect(foot(pop)).toBe('4 items more in List, not yet queued.');
});

test('while a Queue start launches, the queued count, its list and the Queue rail agree, and the row is in Shaping', async () => {
  await mountPage();
  const rail = () => $$('.queue ol > li').map((row) => row.dataset.item);
  expect([text(counter('queued')), rail()]).toEqual(['3', ['I_sample05', 'I_sample06', 'I_sample21']]);
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, startProgress: { I_sample05: { shape: { phase: 'starting' } } } }));
  expect([text(counter('queued')), rail()]).toEqual(['2', ['I_sample06', 'I_sample21']]);
  expect($('[data-stage="shaping"] li[data-item="I_sample05"]')).not.toBeNull();
  await openCounter('queued');
  expect(rows()).toHaveLength(2);
});

test('shipped lists this week\'s done items, newest first', async () => {
  await mountPage();
  const pop = await openCounter('shipped');
  expect(head(pop)).toBe('Shippedlast 7 days');
  expect(rows().map((r) => r.split(' ')[0])).toEqual(['#5', '#40', '#203', '#181']);
});

test('each row is named by its item\'s number and title, not by the popover\'s close', async () => {
  await mountPage();
  await openCounter('building');
  expect(popup()!.querySelector('li button')!.getAttribute('aria-label')).toBe('#150 Relay for streaming away from home');
});

test('spend lists the five priciest items with their cost, out of every priced item', async () => {
  await mountPage(completeSample);
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
  await mountPage(completeSample);
  await settle(() => counter('spend').focus());
  await settle(() => vi.advanceTimersByTime(1000));
  expect(text($('[role="tooltip"]'))).toBe('Agent cost on open and recent items, an API estimate');
});

test('with nothing on the board each popover says so', async () => {
  await mountPage({ ...completeSample, items: [] });
  expect(counters().map(text)).toEqual(['0', '0/2', '0', '0', '$0.00']);
  const empty: [string, string][] = [];
  for (const label of ['need you', 'building', 'queued', 'shipped', 'spend']) {
    const pop = await openCounter(label);
    empty.push([label, text(pop.querySelector('p'))]);
    await settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  }
  expect(empty).toEqual([
    ['need you', 'Nothing waits on you.'],
    ['building', 'Nothing building right now.'],
    ['queued', 'Nothing queued.'],
    ['shipped', 'Nothing shipped this week.'],
    ['spend', 'No priced agent work yet.'],
  ]);
  expect(counter('building').getAttribute('aria-label')).toBe('building: Room for 2 more builds under the build limit of 2');
});

test('queued says it is loading, not empty, while the first read could add items', async () => {
  await mountPage({ ...completeSample, items: [], firstRead: { step: 'items', running: [], settled: false } });
  expect(counter('queued').getAttribute('aria-label')).toBe('queued: Still loading projects');
  const pop = await openCounter('queued');
  expect(text(pop.querySelector('p'))).toBe('Loading projects…');
  expect(pop.querySelector('[data-loader]')).not.toBeNull();
  expect(text(pop)).not.toContain('List is empty.');
});

test('picking a row closes the popover and opens that item\'s dialog', async () => {
  await mountPage();
  await openCounter('building');
  await settle(() => popup()!.querySelector<HTMLButtonElement>('li button')!.click());
  expect(popup()).toBeNull();
  expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe('#150 Relay for streaming away from home');
});

test('spend does not present partial histories as a complete total', async () => {
  const data = structuredClone(sample);
  data.items[0]!.stats = 'unavailable';
  await mountPage(data);
  expect(text(counter('spend'))).toBe('Unavailable');
  const pop = await openCounter('spend');
  expect(head(pop)).toBe('Agent spendIncomplete');
  expect(text(pop)).toContain('Usage totals are incomplete or unavailable.');
});

test('spend reads as unavailable with a failed item, though it shows known figures', async () => {
  const data = structuredClone(completeSample);
  data.items[0] = { ...data.items[0]!, stats: { agentMs: 60_000, tokens: 1000, costUsd: 200 }, usageState: 'failed' };
  await mountPage(data);
  expect(text(counter('spend'))).toBe('Unavailable');
  const pop = await openCounter('spend');
  expect(head(pop)).toBe('Agent spendIncomplete');
  expect(text(pop)).toContain('$200.00');
});

test('spend shows the loader with a loading item, and its popover keeps known figures', async () => {
  const data = structuredClone(completeSample);
  data.items[0] = { ...data.items[0]!, stats: { agentMs: 60_000, tokens: 1000, costUsd: 200 }, usageState: 'loading' };
  await mountPage(data);
  expect(counter('spend').querySelector('[data-loader]')).not.toBeNull();
  expect(text(counter('spend'))).not.toContain('Unavailable');
  const pop = await openCounter('spend');
  expect(head(pop)).toBe('Agent spendLoading');
  expect(text(pop)).toContain('$200.00');
  expect(text(pop)).toContain('Usage totals are still loading.');
});

test('spend while T3 has not answered yet is loading', async () => {
  const data: BoardData = structuredClone(completeSample);
  data.items[0] = { ...data.items[0]!, stats: undefined, threads: 'unavailable', usageState: 'loading' };
  await mountPage(data);
  expect(counter('spend').querySelector('[data-loader]')).not.toBeNull();
});

test('spend with T3 stopped is unavailable', async () => {
  const data: BoardData = structuredClone(completeSample);
  data.items[0] = { ...data.items[0]!, stats: undefined, threads: 'unavailable', usageState: undefined };
  await mountPage(data);
  expect(text(counter('spend'))).toBe('Unavailable');
});

test('a failed whole read says unavailable at once, though items read as loading', async () => {
  const data = structuredClone(completeSample);
  data.items[0] = { ...data.items[0]!, usageState: 'loading' };
  await mountPage({ ...data, usageRead: { readable: false } });
  expect(text(counter('spend'))).toBe('Unavailable');
});

test('an empty need-you popover during the first read shows the loader', async () => {
  const data = structuredClone(completeSample);
  data.items = [];
  data.firstRead = { step: 'items', ready: true, settled: false, running: ['owner/pending'], waiting: ['owner/pending'] };
  await mountPage(data);
  expect(counter('need you').getAttribute('aria-label')).toBe('need you: Still loading projects');
  expect(text((await openCounter('need you')).querySelector('p'))).toBe('Loading projects…');
});

test('spend stays complete with figures frozen at merge, or an item with no threads', async () => {
  const data: BoardData = structuredClone(completeSample);
  data.items[0] = { ...data.items[0]!, stats: { agentMs: 60_000, tokens: 1000, costUsd: 2, frozen: true }, usageState: 'failed' };
  data.items[1] = { ...data.items[1]!, stats: 'unavailable', threads: [] };
  await mountPage(data);
  expect(text(counter('spend'))).not.toBe('Unavailable');
});

test('spend is loading when an empty source succeeds and another still reads', async () => {
  const data = structuredClone(completeSample);
  data.items = [];
  data.firstRead = { step: 'items', ready: true, settled: false, running: ['owner/pending'], waiting: ['owner/pending'] };
  await mountPage(data);
  expect(counter('spend').querySelector('[data-loader]')).not.toBeNull();
  expect(head(await openCounter('spend'))).toBe('Agent spendLoading');
});

test('spend remains incomplete when an empty source succeeds and another failed', async () => {
  const data = structuredClone(completeSample);
  data.items = [];
  data.itemSourceProblems = [{ repo: 'owner/failed', problem: 'Read failed' }];
  await mountPage(data);
  expect(text(counter('spend'))).toBe('Unavailable');
  expect(head(await openCounter('spend'))).toBe('Agent spendIncomplete');
});

test('building animates across the whole factory while the Build heading follows scope and filters', async () => {
  const fresh = { ...limited, error: null, fetchedAt: new Date(NOW).toISOString(), items: sample.items.map(item => ({ ...item, slices: [], threads: [] })) };
  const running = { ...fresh, items: fresh.items.map(item => item.id === 'I_sample14' ? { ...item, kind: 'bug' as const,
    threads: [{ id: 'b', title: 'Build', purpose: 'build', state: 'running' as const, currentRunning: true as const, updated: fresh.fetchedAt }],
  } : item) };
  await mountPage(running);
  const heading = () => $('[data-stage="build"] header > :is(svg, .status-spin)')!;
  const counterIcon = () => counter('building').querySelector('svg')!;
  expect(heading().classList.contains('status-spin')).toBe(true);
  expect(counterIcon().closest('.status-spin')).not.toBeNull();
  let pop = await openCounter('building');
  const members = () => [...popup()!.querySelectorAll('[data-item]')].map(el => el.getAttribute('data-item'));
  const originalMembers = members();
  expect(pop.querySelector('.h-10 > .status-spin')).not.toBeNull();
  expect(pop.querySelector('[data-item="I_sample14"] .status-spin')).not.toBeNull();
  const close = () => settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await close();
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-server'));
  expect(heading().classList.contains('lucide-circle')).toBe(true);
  expect(counterIcon().closest('.status-spin')).not.toBeNull();
  expect(text(counter('building'))).toBe('4/2');
  await openCounter('building');
  expect(members()).toEqual(originalMembers);
  await close();
  await settle(() => useScopeStore.getState().setScope(null));
  await settle(() => $<HTMLButtonElement>('[data-line-filters] [data-filter="kind"]')!.click());
  await settle(() => $$<HTMLLabelElement>('[data-filter-choice]').find(label => text(label) === 'Feature')!.querySelector('input')!.click());
  await close();
  expect(heading().classList.contains('lucide-circle')).toBe(true);
  expect(counterIcon().closest('.status-spin')).not.toBeNull();
  pop = await openCounter('building');
  expect(members()).toEqual(originalMembers);
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(fresh));
  expect(counterIcon().classList.contains('lucide-circle')).toBe(true);
  expect(pop.querySelector('.h-10 > .lucide-circle')).not.toBeNull();
  expect(text(counter('building'))).toBe('4/2');
  expect(members()).toEqual(originalMembers);
});

test('starting and idle builds keep their count and membership while shaping alone leaves the building icons still', async () => {
  const fresh = { ...limited, error: null, fetchedAt: new Date(NOW).toISOString(), items: sample.items.map(item => ({ ...item, slices: [], threads: item.id === 'I_sample02'
    ? [{ id: 's', title: 'Shape', purpose: 'shape', state: 'running' as const, currentRunning: true as const, updated: item.updatedAt }] : [] })),
    startProgress: { I_sample13: { build: { phase: 'starting' as const } } } };
  await mountPage(fresh);
  expect(text(counter('building'))).toBe('5/2');
  expect(counter('building').querySelector('svg.lucide-circle')).not.toBeNull();
  expect(counter('need you').querySelector('svg.status-pulse')).toBeNull();
  expect(counter('need you').querySelector<SVGElement>('svg')!.style.color).toBe('var(--st-amber)');
  const pop = await openCounter('building');
  expect(pop.querySelector('.h-10 > svg.lucide-circle')).not.toBeNull();
  expect(pop.querySelectorAll('[data-item]')).toHaveLength(5);
  expect(pop.querySelector('[data-item="I_sample13"] svg.lucide-circle-arrow-right')).not.toBeNull();
  expect(pop.querySelector('svg.status-pulse, .status-spin')).toBeNull();
});
