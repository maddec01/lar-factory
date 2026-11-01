// Repository Settings save local choices and show effective issue defaults with verified Access.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, chooseOption, fetchMock, mountPage, openOptions, sample, settle, text } from '../../test/support.ts';
import { effectiveVocabulary, type BoardData, type RepositorySetup } from '@lar-factory/shared';

const REPO = 'team/app';

const SETUP: RepositorySetup = {
  repo: REPO, role: 'Backend API server', itemSource: { kind: 'issues' }, labels: ['area: server'],
  domainDocs: { kind: 'off' }, skills: [], ...effectiveVocabulary(),
  access: { 'push-branch': 'allowed', 'open-pr': 'unverified', 'publish-ticket': 'unverified', 'edit-ticket': 'refused', 'tag-ticket': 'refused', 'manage-labels': 'unverified', 'comment-ticket': 'unverified', 'type-ticket': 'unverified', 'relate-ticket': 'unverified' },
  structureSync: true,
  sources: { createIssuesFromAddItem: 'default', createIssuesFromRetro: 'default', writeRefinedSpec: 'default', role: 'local', itemSource: 'default', labels: 'local', domainDocs: 'default', skills: 'default', vocabulary: 'default' },
};

/** The sample board with a generic repository's setup. */
function boardWith(change: Partial<RepositorySetup> = {}, items = sample.items): BoardData {
  return { ...sample, items, repos: [{ ...sample.repos[0]!, repo: change.repo ?? REPO, setup: { ...SETUP, ...change } }, sample.repos[1]!] };
}

/** Serves `board`, and `answer` for each settings change, whose bodies it returns. */
function serve(board: BoardData, answer: (body: Record<string, unknown>) => { status?: number; body: object } = () => ({ body: { board, error: null } })) {
  const sent: Record<string, unknown>[] = [];
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    if (url !== '/api/repositories/settings') return new Response(JSON.stringify(board));
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push(body);
    const reply = answer(body);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  }) as typeof fetchMock);
  return sent;
}

const row = () => $(`.settings-row[data-row="repo-${REPO}"]`)!;
const dialog = () => $('[data-edit-dialog]');
const setting = (key: string) => $(`[data-edit-dialog] [data-setting="${key}"]`)!;
const buttonIn = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button:not([role="combobox"])')].find((b) => text(b) === label);

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

async function openRepositories(board: BoardData): Promise<void> {
  await mountPage(board);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

async function openEdit(board: BoardData): Promise<void> {
  await openRepositories(board);
  await settle(() => buttonIn(row(), 'Edit')!.click());
}

test('settings edit local values and show no repository setup file controls', async () => {
  const board = boardWith(); serve(board);
  await openEdit(board);
  expect(text(dialog())).not.toMatch(/Repository config|shared default|Agent skills/);
  expect(setting('role').querySelector<HTMLInputElement>('input')!.value).toBe('Backend API server');
  expect(text(setting('domainDocs'))).toContain('Off');
  expect(dialog()!.querySelector('[data-source]')).toBeNull();
});

test('save changes a local setting and keeps a refused edit visible', async () => {
  const sent = serve(boardWith(), () => ({ status: 403, body: { error: 'This setting needs access.' } }));
  await openEdit(boardWith());
  await type(setting('skills').querySelector('input')!, 'testing, typing');
  await settle(() => buttonIn(setting('skills'), 'Save')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'skills', value: ['testing', 'typing'] }]);
  expect(text(dialog())).toContain('This setting needs access.');
  expect(setting('skills').querySelector<HTMLInputElement>('input')!.value).toBe('testing, typing');
});

test('access is a single optional summary and recheck runs a real probe', async () => {
  const sent = serve(boardWith()); await openEdit(boardWith());
  const access = dialog()!.querySelector('[data-access]')!;
  expect(access.querySelector('input')).toBeNull();
  await settle(() => buttonIn(access, 'Recheck access')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'recheck' }]);
});

test('concept sync changes on this machine without a repository PR', async () => {
  const sent = serve(boardWith()); await openEdit(boardWith());
  const toggle = dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await settle(() => toggle.click());
  expect(sent).toEqual([{ repo: REPO, change: 'structure-sync', value: false }]);
});

test('issue defaults start on for existing repositories and persist each choice through Settings', async () => {
  let board = boardWith({ access: { ...SETUP.access, 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' } });
  const sent = serve(board, (body) => {
    board = boardWith({ ...board.repos[0]!.setup!, [String(body.key)]: body.value });
    return { body: { board } };
  });
  await openEdit(board);
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    const input = setting(key).querySelector<HTMLInputElement>('input')!;
    expect([input.checked, input.disabled]).toEqual([true, false]);
    await settle(() => input.click());
    expect(setting(key).querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  }
  expect(sent).toEqual(['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec'].map((key) => ({ repo: REPO, change: 'override', key, value: false })));
});

test('issue defaults display independent access denials and recover saved choices after recheck', async () => {
  const denied = boardWith();
  const allowed = boardWith({ access: { ...SETUP.access, 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' }, createIssuesFromRetro: false });
  serve(denied, () => ({ body: { board: allowed } }));
  await openEdit(denied);
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    const input = setting(key).querySelector<HTMLInputElement>('input')!;
    expect([input.checked, input.disabled]).toEqual([false, true]);
  }
  expect(text(setting('createIssuesFromAddItem'))).toContain('not checked yet');
  expect(text(setting('writeRefinedSpec'))).toContain('refused');
  await settle(() => buttonIn(dialog()!.querySelector('[data-access]')!, 'Recheck access')!.click());
  expect(setting('createIssuesFromAddItem').querySelector<HTMLInputElement>('input')!.checked).toBe(true);
  expect(setting('createIssuesFromRetro').querySelector<HTMLInputElement>('input')!.checked).toBe(false);
  expect(setting('writeRefinedSpec').querySelector<HTMLInputElement>('input')!.disabled).toBe(false);
});

test('Azure session read-only disables issue preferences with verified Access', async () => {
  const repo = 'organization/project/repository';
  const board = boardWith({ repo, azureReadOnly: true, access: { ...SETUP.access, 'publish-ticket': 'allowed', 'edit-ticket': 'allowed' } });
  serve(board);
  await openRepositories(board);
  await settle(() => buttonIn($(`.settings-row[data-row="repo-${repo}"]`)!, 'Edit')!.click());
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    const input = setting(key).querySelector<HTMLInputElement>('input')!;
    expect([input.checked, input.disabled]).toEqual([false, true]);
    expect(text(setting(key))).toContain('read-only');
  }
});

test.each(['publish-ticket', 'edit-ticket'] as const)('only the controls needing %s are disabled when it is refused', async (operation) => {
  const board = boardWith({ access: { ...SETUP.access, 'publish-ticket': 'allowed', 'edit-ticket': 'allowed', [operation]: 'refused' } });
  serve(board);
  await openEdit(board);
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    const input = setting(key).querySelector<HTMLInputElement>('input')!;
    const denied = (key === 'writeRefinedSpec') === (operation === 'edit-ticket');
    expect([input.checked, input.disabled]).toEqual([!denied, denied]);
    if (denied) expect(input.getAttribute('aria-describedby')).toBe(setting(key).querySelector('p')!.id);
  }
});

test('legacy private domain docs display off and offer only on or off', async () => {
  const board = boardWith({ domainDocs: { kind: 'private' } as unknown as RepositorySetup['domainDocs'] });
  serve(board);
  await openEdit(board);
  const select = setting('domainDocs').querySelector<HTMLElement>('[role="combobox"]')!;
  expect(text(select)).toBe('Off');
  expect(await openOptions(select)).toEqual(['Off', 'Write in build PRs']);
  expect(dialog()!.compareDocumentPosition($('[role="listbox"]')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the list opens above the dialog').toBeTruthy();
});

const discovery = { provider: 'github', types: { state: 'available', choices: ['Task'] }, labels: { state: 'available', choices: ['bug', 'triage'] } };
const vocabularyRow = (key: string) => $(`[data-vocabulary="${key}"]`)!;

async function openVocabulary() {
  await settle(() => buttonIn(dialog()!, 'Edit vocabulary')!.click());
}

test('vocabulary suggestions are drafts and new labels wait for Save; failures retain the draft', async () => {
  const board = boardWith({ access: { ...SETUP.access, 'tag-ticket': 'allowed', 'manage-labels': 'allowed', 'type-ticket': 'allowed' } });
  const sent = serve(board, (body) => body.change === 'discover-vocabulary'
    ? { body: { discovery } } : { status: 403, body: { error: 'Label creation refused.' } });
  await openEdit(board);
  await openVocabulary();
  expect(sent.length).toBeGreaterThan(0);
  expect(sent.every((body) => body.change === 'discover-vocabulary')).toBe(true);
  sent.length = 0;
  const row = vocabularyRow('bug');
  expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  await settle(() => buttonIn(row, 'Use suggested label: bug')!.click());
  const select = row.querySelector<HTMLElement>('[role="combobox"]')!;
  await chooseOption(select, 'Task');
  await type(row.querySelector<HTMLInputElement>('input[type="text"]')!, 'needs review');
  expect(sent).toHaveLength(0);
  await settle(() => buttonIn(row, 'Save')!.click());
  expect(sent[0]).toEqual({ repo: REPO, change: 'vocabulary', key: 'bug', value: { type: 'Task', labels: ['bug'] }, newLabels: ['needs review'] });
  expect(text(row)).toContain('Label creation refused.');
  expect(row.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('needs review');
  expect(text(select)).toBe('Task');
});

test('vocabulary explains refused reads and Access while still allowing explicit none', async () => {
  const board = boardWith({ ...effectiveVocabulary({ bug: { type: 'Task', labels: ['bug'] } }) });
  const sent = serve(board, (body) => body.change === 'discover-vocabulary'
    ? { body: { discovery: { ...discovery, types: { state: 'unsupported', reason: 'No issue types here.' }, labels: { state: 'refused', reason: 'Metadata read denied.' } } } }
    : { body: { board } });
  await openEdit(board);
  await openVocabulary();
  const row = vocabularyRow('bug');
  expect(text(row)).toContain('No issue types here.');
  expect(text(row)).toContain('Metadata read denied.');
  expect(text(row)).toContain('refused');
  expect(row.querySelector<HTMLInputElement>('input[type="text"]')!.disabled).toBe(true);
  await settle(() => buttonIn(row, 'None')!.click());
  await settle(() => buttonIn(row, 'Save')!.click());
  expect(sent.find((body) => body.change === 'vocabulary')).toEqual({ repo: REPO, change: 'vocabulary', key: 'bug', value: { type: null, labels: [] } });
});

test('a successful vocabulary save displays the provider result and clears the new label draft', async () => {
  let board = boardWith({ access: { ...SETUP.access, 'tag-ticket': 'allowed', 'manage-labels': 'allowed', 'type-ticket': 'allowed' } });
  const sent = serve(board, (body) => {
    if (body.change === 'discover-vocabulary') return { body: { discovery } };
    board = boardWith({ ...board.repos[0]!.setup!, ...effectiveVocabulary({ improvement: { type: 'Task', labels: ['triage'] } }) });
    return { body: { board } };
  });
  await openEdit(board);
  await openVocabulary();
  await type(vocabularyRow('improvement').querySelector<HTMLInputElement>('input[type="text"]')!, 'triage');
  await chooseOption(vocabularyRow('improvement').querySelector('[role="combobox"]')!, 'Task');
  await settle(() => buttonIn(vocabularyRow('improvement'), 'Save')!.click());
  const row = vocabularyRow('improvement');
  expect(row.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe('');
  expect(text(row.querySelector('[role="combobox"]'))).toBe('Task');
  expect([...row.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((i) => i.checked)).toHaveLength(1);
  expect(text(row)).toContain('Saved.');
  expect(sent.filter((body) => body.change === 'vocabulary')).toHaveLength(1);
});

test('Azure vocabulary uses discovered work item types and tags for any repository', async () => {
  const repo = 'organization/project/repository';
  const board = boardWith({ repo, itemSource: { kind: 'azure-board', team: 'Delivery' }, access: { ...SETUP.access, 'tag-ticket': 'allowed', 'type-ticket': 'allowed' } });
  const sent = serve(board, (body) => body.change === 'discover-vocabulary'
    ? { body: { discovery: { provider: 'azure', types: { state: 'available', choices: ['Defect'] }, labels: { state: 'available', choices: ['bug'] } } } }
    : { status: 403, body: { error: 'Write denied.' } });
  await openRepositories(board);
  await settle(() => buttonIn($(`.settings-row[data-row="repo-${repo}"]`)!, 'Edit')!.click());
  await openVocabulary();
  const row = vocabularyRow('bug');
  expect(text(row)).toContain('Work item type');
  expect(text(row)).toContain('Tags');
  await chooseOption(row.querySelector('[role="combobox"]')!, 'Defect');
  await settle(() => buttonIn(row, 'Use suggested label: bug')!.click());
  await settle(() => buttonIn(row, 'Save')!.click());
  expect(sent.find((body) => body.change === 'vocabulary')).toEqual({ repo, change: 'vocabulary', key: 'bug', value: { type: 'Defect', labels: ['bug'] } });
});

test('an upgraded setup with label management not checked can map existing labels but not type a new one', async () => {
  const board = boardWith({ access: { ...SETUP.access, 'tag-ticket': 'allowed', 'type-ticket': 'allowed' } });
  const sent = serve(board, (body) => body.change === 'discover-vocabulary' ? { body: { discovery } } : { body: { setup: board.repos[0]!.setup } });
  await openEdit(board);
  expect(text($('[data-operation="manage-labels"]')!)).toBe('Manage labelsNot checked yet');
  await openVocabulary();
  const row = vocabularyRow('bug');
  expect(row.querySelector<HTMLInputElement>('input[type="text"]')!.disabled).toBe(true);
  expect(text(row)).toContain('Access to manage-labels is not checked yet.');
  await settle(() => buttonIn(row, 'Use suggested label: bug')!.click());
  await settle(() => buttonIn(row, 'Save')!.click());
  expect(sent.find((body) => body.change === 'vocabulary')).toMatchObject({ key: 'bug', value: { labels: ['bug'] } });
});

test('Azure lists tag management and disables a new tag with the reason it has no create', async () => {
  const repo = 'organization/project/repository';
  const board = boardWith({ repo, itemSource: { kind: 'azure-board', team: 'Delivery' }, access: { ...SETUP.access, 'tag-ticket': 'allowed', 'manage-labels': 'allowed' } });
  serve(board, () => ({ body: { discovery: { ...discovery, provider: 'azure' } } }));
  await openRepositories(board);
  await settle(() => buttonIn($(`.settings-row[data-row="repo-${repo}"]`)!, 'Edit')!.click());
  expect(text($('[data-operation="manage-labels"]')!)).toBe('Manage tagsAllowed');
  await openVocabulary();
  const row = vocabularyRow('bug');
  expect(row.querySelector<HTMLInputElement>('input[type="text"]')!.disabled).toBe(true);
  expect(text(row)).toContain('Azure DevOps has no way to create a tag on its own.');
});

test('Azure read-only vocabulary permits clearing mappings and blocks term selection', async () => {
  const repo = 'organization/project/repository';
  const board = boardWith({ repo, azureReadOnly: true, access: { ...SETUP.access, 'tag-ticket': 'allowed', 'type-ticket': 'allowed' } });
  serve(board, () => ({ body: { discovery: { ...discovery, provider: 'azure' } } }));
  await openRepositories(board);
  await settle(() => buttonIn($(`.settings-row[data-row="repo-${repo}"]`)!, 'Edit')!.click());
  await openVocabulary();
  const row = vocabularyRow('bug');
  expect(text(row)).toContain('read-only');
  expect(row.querySelector<HTMLInputElement>('input[type="text"]')!.disabled).toBe(true);
  expect(row.querySelector<HTMLInputElement>('input[type="checkbox"]')!.disabled).toBe(true);
  await openOptions(row.querySelector('[role="combobox"]')!);
  expect($$('[role="option"]').map((o) => [text(o), o.hasAttribute('data-disabled')])).toEqual([['None', false], ['Task', true]]);
  await settle(() => $('[role="listbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settle(() => buttonIn(row, 'None')!.click());
  expect(buttonIn(row, 'Save')!.disabled).toBe(false);
});
