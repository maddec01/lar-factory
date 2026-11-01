// Settings' Labels section lists the tracker's labels and changes them in place, reading only the capability description.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
import { effectiveVocabulary, type BoardData, type RepositorySetup, type TrackerLabel } from '@lar-factory/shared';

const GITHUB = 'team/app';
const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const THIRD = 'third/tracker';

// A third tracker differs from both real ones and lives only in its adapter's description.
vi.mock('@lar-factory/shared', async (actual) => {
  const shared = await actual<typeof import('@lar-factory/shared')>();
  return { ...shared, trackerCapabilities: (repo: string) => repo === 'third/tracker' ? {
    ...shared.trackerCapabilities('team/app'), noun: 'sticker', heading: 'Stickers', description: false,
    deleteWarning: 'This peels it off every card.', changeScope: 'project', createUnavailable: null,
    nameProblem: (name: string) => name.includes('!') ? 'A sticker name has no exclamation mark.' : shared.customLabelProblem(name),
  } : shared.trackerCapabilities(repo) };
});

const SETUP: RepositorySetup = {
  repo: GITHUB, role: '', itemSource: { kind: 'issues' }, labels: ['saved custom label'], domainDocs: { kind: 'off' }, skills: [], ...effectiveVocabulary(),
  access: { 'push-branch': 'allowed', 'open-pr': 'allowed', 'publish-ticket': 'allowed', 'edit-ticket': 'allowed', 'tag-ticket': 'allowed', 'manage-labels': 'allowed', 'comment-ticket': 'allowed', 'type-ticket': 'allowed', 'relate-ticket': 'allowed' },
  structureSync: true,
  sources: { createIssuesFromAddItem: 'default', createIssuesFromRetro: 'default', writeRefinedSpec: 'default', role: 'default', itemSource: 'default', labels: 'local', domainDocs: 'default', skills: 'default', vocabulary: 'default' },
};

const boardWith = (change: Partial<RepositorySetup> = {}, items = sample.items): BoardData =>
  ({ ...sample, items, repos: [{ ...sample.repos[0]!, repo: change.repo ?? GITHUB, setup: { ...SETUP, ...change } }, sample.repos[1]!] });

/** Serves `board`, with the tracker's `labels` changing as the section's writes ask. `fail` answers a call with an error instead. */
function serve(board: BoardData, labels: TrackerLabel[], fail: (body: Record<string, unknown>) => string | undefined = () => undefined) {
  const tracker = { labels, sent: [] as Record<string, unknown>[] };
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    if (url !== '/api/repositories/labels') return new Response(JSON.stringify(board));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown> & { name: string; update: Partial<TrackerLabel> };
    tracker.sent.push(body);
    const error = fail(body);
    if (error) return new Response(JSON.stringify({ error }), { status: 400 });
    if (body.change === 'list') return new Response(JSON.stringify({ labels: tracker.labels, error: null }));
    if (body.change === 'create') tracker.labels = [...tracker.labels, { name: body.name }];
    if (body.change === 'update') tracker.labels = tracker.labels.map((l) => l.name === body.name ? { ...l, ...body.update } : l);
    if (body.change === 'delete') tracker.labels = tracker.labels.filter((l) => l.name !== body.name);
    return new Response(JSON.stringify({ board, error: null }));
  }) as typeof fetchMock);
  return tracker;
}

const section = () => $('[data-edit-dialog] [data-labels]')!;
const rowOf = (name: string) => section().querySelector<HTMLElement>(`[data-label="${name}"]`);
const names = () => [...section().querySelectorAll('[data-label]')].map((row) => row.getAttribute('data-label'));
const buttonIn = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label || b.getAttribute('aria-label') === label);
const creating = () => section().querySelector<HTMLInputElement>('[data-new-label]')!;
const confirmDelete = () => $('[data-delete-label]')!;

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

async function openEdit(board: BoardData): Promise<void> {
  await mountPage(board);
  await openDialog(board);
}

async function openDialog(board: BoardData): Promise<void> {
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => buttonIn($(`.settings-row[data-row="repo-${board.repos[0]!.repo}"]`)!, 'Edit')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

test("the table replaces Custom labels and lists the tracker's labels with colour and description", async () => {
  const board = boardWith();
  serve(board, [{ name: 'docs', color: 'ff0000', description: 'Writing' }, { name: 'area-ui', color: '00ff00' }]);
  await openEdit(board);
  expect(text($('[data-edit-dialog]')!)).not.toMatch(/Custom labels/);
  expect($('[data-edit-dialog] [data-setting="labels"]')).toBeNull();
  expect(names()).toEqual(['area-ui', 'docs']);
  expect(text(rowOf('docs')!)).toContain('Writing');
  expect(rowOf('docs')!.querySelector<HTMLElement>('[data-label-chip]')!.style.backgroundColor).toContain('rgb(255, 0, 0)');
});

test('create writes to the tracker, refreshes from it and refuses a managed name with the reason', async () => {
  const board = boardWith();
  const tracker = serve(board, [{ name: 'docs' }]);
  await openEdit(board);
  await type(creating(), 'linked-work');
  expect(text(section())).toContain("linked-work is reserved for the factory's saved links.");
  expect(buttonIn(section(), 'Create label')!.disabled).toBe(true);
  await type(creating(), 'area-ui');
  await settle(() => buttonIn(section(), 'Create label')!.click());
  expect(tracker.sent).toContainEqual({ repo: GITHUB, change: 'create', name: 'area-ui' });
  expect(names()).toEqual(['area-ui', 'docs']);
  expect(creating().value).toBe('');
});

test("a failed create keeps the typed name and shows the tracker's error", async () => {
  const board = boardWith();
  serve(board, [], (body) => body.change === 'create' ? 'Label already exists.' : undefined);
  await openEdit(board);
  await type(creating(), 'docs');
  await settle(() => buttonIn(section(), 'Create label')!.click());
  expect(text(section())).toContain('Label already exists.');
  expect(creating().value).toBe('docs');
});

test('rename, colour and description open in the row and send only what changed', async () => {
  const board = boardWith();
  const tracker = serve(board, [{ name: 'docs', color: 'ff0000', description: 'Writing' }]);
  await openEdit(board);
  await settle(() => buttonIn(rowOf('docs')!, 'Edit docs')!.click());
  await type(section().querySelector<HTMLInputElement>('[aria-label="Label name"]')!, 'status-done');
  expect(text(section())).toContain('status-done is reserved for board status.');
  expect(buttonIn(rowOf('docs')!, 'Save')!.disabled).toBe(true);
  await type(section().querySelector<HTMLInputElement>('[aria-label="Label name"]')!, 'guides');
  await settle(() => buttonIn(rowOf('docs')!, 'Colour #1D76DB')!.click());
  await settle(() => buttonIn(rowOf('docs')!, 'Save')!.click());
  expect(tracker.sent).toContainEqual({ repo: GITHUB, change: 'update', name: 'docs', update: { name: 'guides', color: '1D76DB' } });
  expect(names()).toEqual(['guides']);
  expect(section().querySelector('[aria-label="Label name"]')).toBeNull();
});

test('delete asks first and states what it removes', async () => {
  const board = boardWith();
  const tracker = serve(board, [{ name: 'docs' }, { name: 'area-ui' }]);
  await openEdit(board);
  await settle(() => buttonIn(rowOf('docs')!, 'Delete docs')!.click());
  expect(tracker.sent.some((body) => body.change === 'delete')).toBe(false);
  expect(text(confirmDelete())).toContain('Delete label "docs"?');
  expect(text(confirmDelete())).toContain('This removes it from every ticket.');
  await settle(() => buttonIn(confirmDelete(), 'Cancel')!.click());
  expect($('[data-delete-label]')).toBeNull();
  await settle(() => buttonIn(rowOf('docs')!, 'Delete docs')!.click());
  await settle(() => buttonIn(confirmDelete(), 'Delete label')!.click());
  expect(tracker.sent).toContainEqual({ repo: GITHUB, change: 'delete', name: 'docs' });
  expect(names()).toEqual(['area-ui']);
  expect($('[data-delete-label]')).toBeNull();
});

test('Escape closes only the delete confirmation', async () => {
  const board = boardWith();
  serve(board, [{ name: 'docs' }]);
  await openEdit(board);
  await settle(() => buttonIn(rowOf('docs')!, 'Delete docs')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  const focused = document.activeElement ?? document.body;
  await settle(() => focused.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await settle(() => vi.advanceTimersByTime(50));
  expect($('[data-delete-label]')).toBeNull();
  expect($('[data-edit-dialog]')).not.toBeNull();
});

test('managed labels appear locked, with no controls', async () => {
  const board = boardWith();
  serve(board, [{ name: 'linked-work' }, { name: 'Bug' }, { name: 'docs' }]);
  await openEdit(board);
  for (const name of ['linked-work', 'Bug']) {
    expect(rowOf(name)!.querySelector('[aria-label="Factory-managed"]')).not.toBeNull();
    expect(rowOf(name)!.querySelector('button')).toBeNull();
  }
  expect(text(rowOf('linked-work')!)).toContain("reserved for the factory's saved links");
  expect(rowOf('docs')!.querySelector('[aria-label="Factory-managed"]')).toBeNull();
});

test('a failed read offers Retry, and each read shows what the tracker holds now', async () => {
  const board = boardWith();
  let down = true;
  const tracker = serve(board, [{ name: 'docs' }], () => down ? 'GitHub is unavailable.' : undefined);
  await openEdit(board);
  expect(text(section())).toContain('GitHub is unavailable.');
  down = false;
  tracker.labels = [{ name: 'made-on-github' }];
  await settle(() => buttonIn(section(), 'Retry')!.click());
  expect(names()).toEqual(['made-on-github']);
});

test('without management access the section is read-only and states the reason', async () => {
  const board = boardWith({ access: { ...SETUP.access, 'manage-labels': 'refused' } });
  const tracker = serve(board, [{ name: 'docs' }]);
  await openEdit(board);
  expect(text(section())).toContain('Access to manage-labels was refused.');
  expect(creating().disabled).toBe(true);
  expect(buttonIn(section(), 'Create label')!.disabled).toBe(true);
  expect(buttonIn(rowOf('docs')!, 'Edit docs')!.disabled).toBe(true);
  expect(buttonIn(rowOf('docs')!, 'Delete docs')!.disabled).toBe(true);
  expect(tracker.sent.every((body) => body.change === 'list')).toBe(true);
});

test('on Azure there is no colour or description, create is disabled with the reason, and delete names pull requests', async () => {
  const board = boardWith({ repo: AZURE, itemSource: { kind: 'azure-board', team: 'Delivery' } });
  const tracker = serve(board, [{ name: 'docs' }]);
  await openEdit(board);
  expect(text(section())).toContain('Tags');
  expect(text(section())).toContain('the whole project');
  expect(creating().disabled).toBe(true);
  expect(buttonIn(section(), 'Create tag')!.disabled).toBe(true);
  expect(text(section())).toContain('Azure DevOps has no way to create a tag on its own.');
  await settle(() => buttonIn(rowOf('docs')!, 'Edit docs')!.click());
  expect(text(rowOf('docs')!)).toContain('Renaming affects the whole project');
  expect(buttonIn(rowOf('docs')!, 'Colour #1D76DB')).toBeUndefined();
  expect(section().querySelector('[aria-label="Tag description"]')).toBeNull();
  await type(section().querySelector<HTMLInputElement>('[aria-label="Tag name"]')!, 'a;b');
  expect(text(section())).toContain('Use a tag name without commas or semicolons.');
  await type(section().querySelector<HTMLInputElement>('[aria-label="Tag name"]')!, 'guides');
  await settle(() => buttonIn(rowOf('docs')!, 'Save')!.click());
  expect(tracker.sent).toContainEqual({ repo: AZURE, change: 'update', name: 'docs', update: { name: 'guides' } });
  await settle(() => buttonIn(rowOf('guides')!, 'Delete guides')!.click());
  expect(text(confirmDelete())).toContain('This removes it from every work item and pull request.');
});

test('an Azure read-only session leaves the section read-only and states the reason', async () => {
  const board = boardWith({ repo: AZURE, itemSource: { kind: 'azure-board', team: 'Delivery' }, azureReadOnly: true });
  serve(board, [{ name: 'docs' }]);
  await openEdit(board);
  expect(text(section())).toContain('Azure DevOps is read-only in this test session.');
  expect(buttonIn(rowOf('docs')!, 'Delete docs')!.disabled).toBe(true);
});

test('a third tracker drives the table and row chips with no change outside its adapter', async () => {
  const items = sample.items.map((item, at) => at === 0 ? { ...item, repo: THIRD, status: 'Queued' as const, labels: ['linked-work', 'shiny'], labelColors: { shiny: '#123456' } } : item);
  const board = boardWith({ repo: THIRD }, items);
  const tracker = serve(board, [{ name: 'shiny', color: '123456', description: 'Not shown' }]);
  await mountPage(board);
  const chips = $$('[data-label-chip]').filter((chip) => text(chip) === 'shiny');
  expect(chips.length).toBeGreaterThan(0);
  expect((chips[0] as HTMLElement).style.backgroundColor).toContain('rgb(18, 52, 86)');
  expect($$('[data-label-chip]').some((chip) => text(chip) === 'linked-work')).toBe(false);
  await openDialog(board);
  expect(text(section())).toContain('Stickers');
  expect(text(section())).toContain('the whole project');
  expect(text(rowOf('shiny')!)).not.toContain('Not shown');
  await type(creating(), 'wow!');
  expect(text(section())).toContain('A sticker name has no exclamation mark.');
  await type(creating(), 'matte');
  await settle(() => buttonIn(section(), 'Create sticker')!.click());
  expect(tracker.sent).toContainEqual({ repo: THIRD, change: 'create', name: 'matte' });
  await settle(() => buttonIn(rowOf('shiny')!, 'Edit shiny')!.click());
  expect(buttonIn(rowOf('shiny')!, 'Colour #1D76DB')).toBeDefined();
  expect(section().querySelector('[aria-label="Sticker description"]')).toBeNull();
  await settle(() => buttonIn(rowOf('shiny')!, 'Delete shiny')!.click());
  expect(text(confirmDelete())).toContain('This peels it off every card.');
});

test('saved settings holding labels still load', async () => {
  const board = boardWith({ labels: ['area: server'] });
  serve(board, []);
  await openEdit(board);
  expect(section()).not.toBeNull();
});
