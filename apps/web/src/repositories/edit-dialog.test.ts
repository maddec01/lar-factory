// Edit in Settings › Repositories: the dialog shows each of the repository's settings with where it comes from, saves
// a local override or removes it so the shared default applies again, says why a Repository config can't be used while
// the last usable setup stays, and rechecks access. A changed item source or domain-doc location names the work it
// pauses on the repository's row, with Accept. Offer sets the operations the factory offers, within the access found.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
import type { BoardData, RepositorySetup } from '@lar-factory/shared';

const REPO = 'maddec01/lar-server';

const SETUP: RepositorySetup = {
  repo: REPO, role: 'Backend API server', itemSource: { kind: 'issues' }, labels: ['area: server'],
  domainDocs: { kind: 'private' }, skills: [],
  access: { 'push-branch': 'allowed', 'open-pr': 'unverified', 'publish-ticket': 'unverified', 'edit-ticket': 'refused', 'tag-ticket': 'refused' },
  consent: ['push-branch'], paused: [],
  sources: { role: 'shared', itemSource: 'default', labels: 'local', domainDocs: 'default', skills: 'default' },
  shared: { role: 'Backend API server', labels: ['area: web'] },
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

test('Edit shows each setting with where it comes from, has no Show setting, and Settings offers no Reset', async () => {
  const board = boardWith();
  serve(board);
  await openRepositories(board);
  expect(buttonIn(row(), 'Reset')).toBeUndefined();
  await settle(() => buttonIn(row(), 'Edit')!.click());
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe(`Edit ${REPO}`);
  expect([...dialog()!.querySelectorAll('[data-setting]')].map((s) => s.getAttribute('data-setting'))).toEqual(['role', 'itemSource', 'labels', 'domainDocs', 'skills']);
  expect(dialog()!.querySelector('[aria-label="Show"]')).toBeNull();
  expect(text(setting('role').querySelector('[data-source]'))).toBe('Shared default');
  expect(text(setting('labels').querySelector('[data-source]'))).toBe('Set on this Mac');
  expect(text(setting('domainDocs').querySelector('[data-source]'))).toBe('Factory default');
  expect(text(setting('itemSource'))).toContain("This repository's GitHub issues.");
  expect(text(setting('labels').querySelector('[data-shared]'))).toBe('Shared default: area: web');
  expect(setting('role').querySelector<HTMLInputElement>('input')!.value).toBe('Backend API server');
});

test('Save sets a local override and the board sent back shows it; Use shared default removes it', async () => {
  const saved = boardWith({ role: 'My API', sources: { ...SETUP.sources, role: 'local' } });
  const sent = serve(boardWith(), (body) => ({ body: { board: body.value === undefined ? boardWith() : saved, error: null } }));
  await openEdit(boardWith());
  expect(buttonIn(setting('role'), 'Save')!.disabled, 'nothing changed yet').toBe(true);
  expect(buttonIn(setting('role'), 'Use shared default'), 'no override to remove').toBeUndefined();
  await type(setting('role').querySelector('input')!, 'My API');
  await settle(() => buttonIn(setting('role'), 'Save')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'role', value: 'My API' }]);
  expect(text(setting('role').querySelector('[data-source]'))).toBe('Set on this Mac');
  await settle(() => buttonIn(setting('labels'), 'Use shared default')!.click());
  expect(sent[1]).toEqual({ repo: REPO, change: 'override', key: 'labels' });
});

test('a list setting saves its comma-separated values, and a refused change keeps the dialog with why', async () => {
  const sent = serve(boardWith(), () => ({ status: 400, body: { error: `${REPO}: field labels must be an array of strings.` } }));
  await openEdit(boardWith());
  await type(setting('labels').querySelector('input')!, 'area: server, area: api ,');
  await settle(() => buttonIn(setting('labels'), 'Save')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'override', key: 'labels', value: ['area: server', 'area: api'] }]);
  expect(text(dialog()!.querySelector('[role="alert"]'))).toContain('field labels must be an array of strings.');
  expect(setting('labels').querySelector<HTMLInputElement>('input')!.value).toBe('area: server, area: api ,');
});

test("a Repository config that can't be used says why while the last usable setup stays", async () => {
  const board = boardWith({ sharedProblem: ".lar-factory.json isn't valid JSON." });
  serve(board);
  await openEdit(board);
  expect(text(dialog()!.querySelector('[data-shared-problem]'))).toContain(".lar-factory.json isn't valid JSON.");
  expect(text(dialog()!.querySelector('[data-shared-problem]'))).toContain('last usable');
  expect(setting('role').querySelector<HTMLInputElement>('input')!.value).toBe('Backend API server');
});

test('Recheck access forgets what the credentials allowed, after they changed', async () => {
  const sent = serve(boardWith());
  await openEdit(boardWith());
  const access = $('[data-edit-dialog] [data-access]')!;
  expect(text(access.querySelector('[data-operation="edit-ticket"]'))).toContain('Refused');
  expect(text(access.querySelector('[data-operation="push-branch"]'))).toContain('Allowed');
  await settle(() => buttonIn(access, 'Recheck access')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'recheck' }]);
});

test('Offer changes which operations the factory offers, and a refused one cannot be offered', async () => {
  const sent = serve(boardWith());
  await openEdit(boardWith());
  const offer = (op: string) => $<HTMLInputElement>(`[data-edit-dialog] [data-operation="${op}"] input[type="checkbox"]`)!;
  expect([offer('push-branch').checked, offer('open-pr').checked]).toEqual([true, false]);
  expect(offer('edit-ticket').disabled, 'the credentials refuse it').toBe(true);
  expect(['publish-ticket', 'tag-ticket'].map((op) => $(`[data-edit-dialog] [data-operation="${op}"]`)), 'publishing writes wait for a later build').toEqual([null, null]);
  expect(text($('[data-edit-dialog] [data-access]'))).toContain('the first time you publish refined work');
  await settle(() => offer('open-pr').click());
  expect(sent).toEqual([{ repo: REPO, change: 'consent', value: ['push-branch', 'open-pr'] }]);
  await settle(() => offer('push-branch').click());
  expect(sent.at(-1)).toEqual({ repo: REPO, change: 'consent', value: [] });
});

test("a changed shared item source names the work it pauses on the repository's row, and Accept lets that work go on", async () => {
  const why = "Its repository's item source changed. Accept the change in Settings › Repositories to go on.";
  const items = sample.items.map((item) => item.id === 'I_sample01' ? { ...item, paused: why } : item);
  const sent = serve(boardWith({ paused: ['itemSource'] }, items), () => ({ body: { board: boardWith(), error: null } }));
  await openRepositories(boardWith({ paused: ['itemSource'] }, items));
  const notice = row().querySelector('[data-setup-paused]')!;
  expect(text(notice)).toContain('Its item source changed');
  expect(text(notice)).toContain('Arr instances, catalog bindings and content requests');
  await settle(() => buttonIn(notice, 'Accept')!.click());
  expect(sent).toEqual([{ repo: REPO, change: 'accept' }]);
  expect(row().querySelector('[data-setup-paused]')).toBeNull();
});
