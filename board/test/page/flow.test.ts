// The Flow view: the outline of parents, sub-issues, blocked-by and blocks links, and its jumps.
// Ported from the Flow cases of test/render.test.ts.

import { expect, test } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle } from './support.ts';
import { normalizeItems } from '../../src/github.ts';
import type { BoardData } from '../../src/model.ts';
import { rawIssue, sliceRef } from '../raw-items.ts';
import type { RawItem } from '../../src/github.ts';

const node = (id: string) => $(`#o-${id}`)!;
const text = (el: Element | null | undefined) => el?.textContent ?? '';
/** A node's own link rows, not its sub-issues'. */
const links = (id: string) => [...node(id).querySelectorAll(':scope > .o-links > li')];
const boardOf = (raws: RawItem[], builds = new Set<string>()): BoardData => ({ ...sample, error: null, items: normalizeItems(raws, { builds }) });
const builtIssue = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
  subIssuesSummary: { total: 4, completed: 2 },
  subIssues: { nodes: [sliceRef(65, 'CLOSED'), { ...sliceRef(66, 'CLOSED'), stateReason: 'NOT_PLANNED' }, sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
});

test('Flow nests sub-issues under their parent and counts the ones not on the Board', async () => {
  await mountPage(sample, '#flow');
  const concept = node('PVTI_sample09');
  for (const id of ['PVTI_sample10', 'PVTI_sample12', 'PVTI_sample13', 'PVTI_sample18']) expect(concept.querySelector(`#o-${id}`), `${id} nests under #200`).not.toBeNull();
  expect(text(concept.querySelector(':scope > .o-tree > .o-missing')), 'six sub-issues, four on the Board').toBe('2 more sub-issues not on the board');
});

test("a build counts its slices, not sub-issues, and none of them is missing", async () => {
  await mountPage(sample, '#flow');
  const build = node('PVTI_sample13');
  expect(text(build.querySelector(':scope > .o-row > .o-subs'))).toBe('1/3 slices done');
  expect(build.querySelector('.o-missing'), "a build's slices are never on the board").toBeNull();
  expect($('[data-anchor^="o:PVTI_slice"]'), 'slices are not board items').toBeNull();
});

test("Flow counts only a build's visible slices, not GitHub's sub-issue totals", async () => {
  await mountPage(boardOf([builtIssue]), '#flow');
  expect(text(node('PVTI_build').querySelector('.o-subs'))).toBe('1/3 slices done');
});

test('an open slice that the project auto-added has no Flow node of its own', async () => {
  const slice = rawIssue('PVTI_slice66', 66, 'In progress', ['improvement'], {
    parent: { number: 59, title: 'Issue 59', url: 'https://github.com/maddec01/mux-factory/issues/59', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-factory' } },
  });
  await mountPage(boardOf([slice, builtIssue]), '#flow');
  expect($('#o-PVTI_build')).not.toBeNull();
  expect($('#o-PVTI_slice66')).toBeNull();
});

test('a build shows its `build` sub-issues like any parent, and counts the ones not on the board', async () => {
  const parent = rawIssue('PVTI_parent', 100, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 0 },
    subIssues: { nodes: [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN'), sliceRef(103, 'OPEN')] },
  });
  const child = rawIssue('PVTI_102', 102, 'In progress', ['build'], {
    parent: { number: 100, title: 'Issue 100', url: 'https://github.com/maddec01/mux-factory/issues/100', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-factory' } },
  });
  await mountPage(boardOf([parent, child], new Set(['maddec01/mux-factory#102', 'maddec01/mux-factory#103'])), '#flow');
  expect(node('PVTI_parent').querySelector('#o-PVTI_102'), 'the build sub-issue nests under it').not.toBeNull();
  expect(text(node('PVTI_parent').querySelector('.o-missing')), 'the slice is never missing; the other build is').toBe('1 more sub-issue not on the board');
});

test('Flow shows blocked-by and blocks links from GitHub, jumping to Board items and referencing the rest', async () => {
  await mountPage(sample, '#flow');
  const [blockedBy] = links('PVTI_sample12');
  expect(blockedBy!.className).toBe('o-link o-blocked-by');
  expect(text(blockedBy)).toBe('blocked by #201 Relay: broker only or full TURN? Shaping');
  expect(blockedBy!.querySelector('a.o-ref')!.getAttribute('href')).toBe('#flow');
  expect(blockedBy!.querySelector<HTMLElement>('a.o-ref')!.dataset.outlineJump).toBe('PVTI_sample10');
  expect(links('PVTI_sample10').map(text)).toContain('blocks #202 Sign-in screen Needs you');

  const owner = links('PVTI_sample13');
  const off = owner.find((li) => text(li).includes('#118'))!;
  expect(text(off)).toBe('blocked by #118 Accounts table migration not on board · open');
  const ref = off.querySelector('a.o-ref.off')!;
  expect([ref.getAttribute('href'), ref.getAttribute('target'), ref.getAttribute('rel')]).toEqual(['https://github.com/maddec01/mux-server/issues/118', '_blank', 'noopener']);
  expect(owner.find((li) => li.classList.contains('o-blocks'))!.querySelector<HTMLElement>('a.o-ref')!.dataset.outlineJump).toBe('PVTI_sample05');

  expect(links('PVTI_sample16').map(text), 'closed blockers are listed too').toContain('blocked by #27 Artwork cache eviction not on board · closed');
  expect(links('PVTI_sample15').map(text), 'a Done item older than 7 days is hidden, so it counts as not on the Board').toContain('blocked by #100 Old cleanup task not on board · closed');
  expect($('#o-PVTI_sample20'), 'and gets no node of its own').toBeNull();
});

test('Flow groups items under a parent that is not on the Board, with its state', async () => {
  await mountPage(sample, '#flow');
  const root = $('.o-offroot')!;
  expect(text(root.querySelector(':scope > .o-row'))).toBe('mux-apple#9 Home screen refresh not on board · open');
  expect(root.querySelector(':scope > .o-row > a.o-ref.off')!.getAttribute('href')).toBe('https://github.com/maddec01/mux-apple/issues/9');
  expect(root.querySelector('#o-PVTI_sample08') && root.querySelector('#o-PVTI_sample11'), 'both of its sub-issues sit under it').not.toBeNull();
});

test('a parent hidden from the Board is a reference too', async () => {
  const done = sample.items.find((i) => i.id === 'PVTI_sample20')!;
  const orphan = { ...sample.items[0]!, parent: { number: 100, title: done.title, url: done.url!, repo: done.repo!, state: 'CLOSED' as const } };
  await mountPage({ ...sample, items: [orphan, done] }, '#flow');
  expect(text($('.o-offroot > .o-row'))).toBe('mux-server#100 Old cleanup task not on board · closed');
});

test('Flow counts links beyond the first ones GitHub returned, and never infers a link', async () => {
  const ref = (number: number) => ({ number, title: `Issue ${number}`, url: `https://github.com/maddec01/mux-server/issues/${number}`, repo: 'maddec01/mux-server', state: 'OPEN' as const });
  const blocked = { ...sample.items[0]!, blockers: { total: 23, nodes: [ref(1), ref(2)] }, blocking: { total: 4, nodes: [ref(3)] } };
  const blocker = { ...sample.items[1]!, number: 1, title: 'Issue 1' };
  await mountPage({ ...sample, items: [blocked, blocker] }, '#flow');
  const more = links(blocked.id).filter((li) => li.classList.contains('o-more'));
  expect(more.map((li) => [li.className, text(li)])).toEqual([
    ['o-link o-blocked-by o-more', 'blocked by 21 more issues'],
    ['o-link o-blocks o-more', 'blocks 3 more issues'],
  ]);
  expect($(`#o-${blocker.id} .o-link`), "the blocker's own blocking list is empty, so it shows no link back").toBeNull();
});

test('Flow has a legend, and lists items with no relationships in a closed group', async () => {
  await mountPage(sample, '#flow');
  expect($$('.o-legend li').map(text)).toContain("blocks GitHub's blocking link");
  const loose = $<HTMLDetailsElement>('details#flow-loose.platform.o-loose')!;
  expect(loose.open).toBe(false);
  expect(text(loose.querySelector('summary'))).toMatch(/^\d+ items with no recorded relationships$/);
  expect(loose.querySelectorAll('.rows > .row-item[data-anchor^="o:"]').length).toBeGreaterThan(0);
});

test('the outline jump brings the item into view, flashes it and moves focus to its title, staying on Flow', async () => {
  await mountPage(sample, '#flow');
  const jump = links('PVTI_sample12')[0]!.querySelector<HTMLAnchorElement>('a[data-outline-jump]')!;
  let prevented = false;
  document.addEventListener('click', (event) => (prevented = event.defaultPrevented), { once: true });
  await settle(() => jump.click());
  const target = node('PVTI_sample10');
  expect(prevented, 'the hash still picks the view').toBe(true);
  expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  expect(target.classList.contains('anchor-flash')).toBe(true);
  expect(document.activeElement).toBe(target.querySelector('a.o-title'));
  expect(location.hash).toBe('#flow');
});
