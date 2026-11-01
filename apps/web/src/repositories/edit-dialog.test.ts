// Edit in Settings › Repositories: the dialog shows each of the repository's settings with where it comes from, saves
// a local override or removes it so the shared default applies again, says why a Repository config can't be used while
// the last usable setup stays, and rechecks access. A changed item source or domain-doc location names the work it
// pauses on the repository's row, with Accept. Offer sets the operations the factory offers, within the access found.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
import { effectiveVocabulary, type BoardData, type RepositorySetup } from '@lar-factory/shared';

const REPO = 'maddec01/lar-server';

const SETUP: RepositorySetup = {
  repo: REPO, role: 'Backend API server', itemSource: { kind: 'issues' }, labels: ['area: server'],
  domainDocs: { kind: 'off' }, skills: [], ...effectiveVocabulary(),
  access: { 'push-branch': 'allowed', 'open-pr': 'unverified', 'publish-ticket': 'unverified', 'edit-ticket': 'refused', 'tag-ticket': 'refused', 'comment-ticket': 'unverified', 'type-ticket': 'unverified', 'relate-ticket': 'unverified' },
  structureSync: true,
  sources: { createIssuesFromAddItem: 'default', createIssuesFromRetro: 'default', writeRefinedSpec: 'default', role: 'local', itemSource: 'default', labels: 'local', domainDocs: 'default', skills: 'default', vocabulary: 'default' },
};

/** The sample board with `change` made to lar-server's setup. */
function boardWith(change: Partial<RepositorySetup> = {}, items = sample.items): BoardData {
  return { ...sample, items, repos: [{ ...sample.repos[0]!, setup: { ...SETUP, ...change } }, sample.repos[1]!] };
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
const buttonIn = (el: Element, label: string) => [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label);

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
  await type(setting('labels').querySelector('input')!, 'area: server, area: api');
  await settle(() => buttonIn(setting('labels'), 'Save')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'labels', value: ['area: server', 'area: api'] }]);
  expect(text(dialog())).toContain('This setting needs access.');
  expect(setting('labels').querySelector<HTMLInputElement>('input')!.value).toBe('area: server, area: api');
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
