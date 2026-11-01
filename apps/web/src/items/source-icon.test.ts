// Source names through the rendered board. DOM tests cover semantics and placement, not pixel layout.
import { expect, test } from 'vite-plus/test';
import type { BoardData, Item } from '@lar-factory/shared';
import { $, mountPage, push, sample, settle } from '../../test/support.ts';

const local: Item = { ...sample.items[0]!, id: 'source-work', repo: 'example/product', number: 0, url: null,
  title: 'Export a report', kind: 'feature', status: 'Ready', statuses: ['Ready'], parent: null, parentId: null,
  subIssues: { total: 0, completed: 0 }, slices: [], blockers: [], linkedPrs: [] };
const board = (item: Item): BoardData => ({ ...sample, items: [item], repos: [{ repo: item.repo, role: '', labels: [] }] });

test.each<[string, Partial<Item>, string]>([
  ['local GitHub work', {}, 'Saved only on this machine.'],
  ['local Azure work', { repo: 'example/project/product' }, 'Saved only on this machine.'],
  ['local work with cached Azure fields', { azure: { type: 'Task', state: 'New', assignee: null } }, 'Saved only on this machine.'],
  ['GitHub issue', { number: 17, url: 'https://github.com/example/product/issues/17' }, 'GitHub issue. Saved on GitHub.'],
  ['GitHub issue before its URL loads', { number: 17 }, 'GitHub issue. Saved on GitHub.'],
  ['Azure work item', { repo: 'example/project/product', number: 23, url: 'https://dev.azure.com/example/project/_workitems/edit/23' }, 'Azure DevOps work item. Saved in Azure DevOps.'],
  ['Azure board work in a GitHub repository', { number: 23, azure: { type: 'Task', state: 'New', assignee: null } }, 'Azure DevOps work item. Saved in Azure DevOps.'],
])('a desk card identifies %s with an accessible source icon', async (_name, change, label) => {
  await mountPage(board({ ...local, ...change }));
  const card = $('.desk-card')!;
  const source = card.querySelector('[role="img"]');
  expect(source?.getAttribute('aria-label')).toBe(label);
  expect(source?.getAttribute('title')).toBe(label);
  expect(source?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(source?.className.split(' ')).toEqual(expect.arrayContaining(['absolute', 'top-0', 'right-0', 'size-6']));
  expect(card.querySelector('[role="img"][tabindex]')).toBeNull();
});

test.each(['map', 'list'])('dossier parts identify their own source in the %s view', async view => {
  const parent: Item = { ...local, id: 'source-concept', kind: 'concept', status: 'Shaping', statuses: ['Shaping'] };
  const children: Item[] = [
    { ...local, id: 'github-part', parentId: parent.id, number: 17, url: 'https://github.com/example/product/issues/17' },
    { ...local, id: 'azure-part', parentId: parent.id, repo: 'example/project/product', number: 23, url: 'https://dev.azure.com/example/project/_workitems/edit/23' },
    { ...local, id: 'local-part', parentId: parent.id },
  ];
  localStorage.setItem('lar-board:dossier-open:source-concept', '1');
  localStorage.setItem('lar-board:dossier-view:source-concept', view);
  await mountPage({ ...board(parent), items: [parent, ...children] });
  const row = view === 'map' ? 'data-map-part' : 'data-part';
  expect($(`[${row}="github-part"] [role="img"]`)?.getAttribute('aria-label')).toBe('GitHub issue. Saved on GitHub.');
  expect($(`[${row}="azure-part"] [role="img"]`)?.getAttribute('aria-label')).toBe('Azure DevOps work item. Saved in Azure DevOps.');
  expect($(`[${row}="local-part"] [role="img"]`)?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  const source = $(`[${row}="local-part"] [role="img"]`)!;
  expect(source.classList.contains('absolute')).toBe(view === 'map');
  expect(source.classList.contains('shrink-0')).toBe(view === 'list');
});

test('List and the details it opens identify local work even in an Azure repository', async () => {
  await mountPage(board({ ...local, repo: 'example/project/product', status: 'List', statuses: ['List'] }));
  await settle(() => $<HTMLButtonElement>('.list-button')!.click());
  const row = $<HTMLButtonElement>('[data-list-modal] button[data-item]')!;
  expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  await settle(() => row.click());
  expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
});

test.each<[string, Partial<Item>, string]>([
  ['Queue', { status: 'Queued', statuses: ['Queued'] }, '.queue [data-item]'],
  ['in-flight row', { status: 'Shaping', statuses: ['Shaping'] }, '[data-in-flight] [data-item]'],
  ['dossier', { status: 'Shaping', statuses: ['Shaping'], kind: 'concept' }, '[data-dossier] [data-item]'],
])('%s identifies its source alongside the title', async (_name, change, selector) => {
  await mountPage(board({ ...local, number: 17, url: 'https://github.com/example/product/issues/17', ...change }));
  const row = $(selector)!;
  expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('GitHub issue. Saved on GitHub.');
});

test('the title-bar item rows identify their source and still open details', async () => {
  await mountPage(board(local));
  await settle(() => $<HTMLButtonElement>('.counters button[aria-label^="need you:"]')!.click());
  const row = $<HTMLButtonElement>('.counter-popup button[data-item]')!;
  expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  await settle(() => row.click());
  expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
});

test('expanded slice rows and their details keep each slice source', async () => {
  const item: Item = { ...local, status: 'In progress', statuses: ['In progress'], slices: [
    { number: 0, repo: 'example/product', title: 'Local slice', url: '', state: 'open', progress: 'active', workId: 'local-slice' },
    { number: 17, repo: 'example/product', title: 'GitHub slice', url: 'https://github.com/example/product/issues/17', state: 'open', progress: 'waiting' },
    { number: 23, repo: 'example/project/product', title: 'Azure slice', url: 'https://dev.azure.com/example/project/_workitems/edit/23', state: 'open', progress: 'waiting' },
  ] };
  await mountPage(board(item));
  await settle(() => $<HTMLButtonElement>('[data-flight] button[aria-label="Show slices"]')!.click());
  const labels = (selector: string) => [...$(selector)!.querySelectorAll('[role="img"]')].map(icon => icon.getAttribute('aria-label'));
  expect(labels('[data-flight] [data-slices]')).toEqual(['Saved only on this machine.', 'GitHub issue. Saved on GitHub.', 'Azure DevOps work item. Saved in Azure DevOps.']);
  await settle(() => $<HTMLElement>('[data-flight] [data-item]')!.click());
  expect(labels('[data-item-dialog] [data-slices]')).toEqual(['Saved only on this machine.', 'GitHub issue. Saved on GitHub.', 'Azure DevOps work item. Saved in Azure DevOps.']);
});

test.each<[Item['status'], string, number, string, string]>([
  ['List', 'example/product', 17, 'https://github.com/example/product/issues/17', 'GitHub issue. Saved on GitHub.'],
  ['List', 'example/project/product', 23, 'https://dev.azure.com/example/project/_workitems/edit/23', 'Azure DevOps work item. Saved in Azure DevOps.'],
  ['Ready', 'example/product', 17, 'https://github.com/example/product/issues/17', 'GitHub issue. Saved on GitHub.'],
  ['Ready', 'example/project/product', 23, 'https://dev.azure.com/example/project/_workitems/edit/23', 'Azure DevOps work item. Saved in Azure DevOps.'],
])('conversion in %s updates %s and its open details without a reload', async (status, repo, number, url, label) => {
  const item: Item = { ...local, status, statuses: [status], repo };
  await mountPage(board(item));
  if (status === 'List') await settle(() => $<HTMLButtonElement>('.list-button')!.click());
  const row = $<HTMLElement>(status === 'List' ? '[data-list-modal] button[data-item]' : '.desk-card')!;
  expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  await settle(() => row.click());
  expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  await push(board({ ...item, number, url }));
  expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(label);
  expect($('[data-item-summary] [role="img"]')?.getAttribute('aria-label')).toBe(label);
});
