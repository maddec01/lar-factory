// Edit in Settings › Repositories: the dialog loads the repository's .lar-factory.json values and labels into
// onboarding's setup fields and custom label picker, holds Save while a field has a problem or nothing changed, saying
// so then, and Save opens the PR, keeping the dialog and its answers with gh's message when that fails.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, checkedOf, fetchMock, mountPage, sample, settle, text, toast } from '../../test/support.ts';
import { WORKFLOW_LABELS, type BoardData } from '@lar-factory/shared';

const REPO = 'maddec01/lar-server';
const PR = 'https://github.com/maddec01/lar-server/pull/21';
const CONFIG = { itemSource: { kind: 'issues' }, show: 'all', role: 'Backend API server', labels: ['area: server'] };
const LABELS = [...WORKFLOW_LABELS.map((l) => l.name), 'area: server', 'area: web', 'status-list'];

type Answer = { status?: number; body: object };

/**
 * Serves the sample as the board, `load` for Edit's load and `pr` for its Save, once it settles, and returns the bodies
 * each got.
 */
function serve(load: Answer = { body: { config: CONFIG, labels: LABELS, error: null } }, pr: Answer | Promise<Answer> = { body: { prUrl: PR, error: null } },
  board: BoardData = sample) {
  const sent: Record<string, object[]> = {};
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    if (url === '/api/onboarding/teams') return new Response(JSON.stringify({ teams: ['Fabrikam Team', 'API Team'] }));
    const pending = url === '/api/repositories/config' ? load : url === '/api/repositories/config/pr' ? pr : null;
    if (!pending) return new Response(JSON.stringify(board));
    (sent[url] ??= []).push(JSON.parse(String(init?.body)));
    const answer = await pending;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetchMock);
  return sent;
}

const dialog = () => $('[data-edit-dialog]');
const save = () => $<HTMLButtonElement>('[data-edit-dialog] [data-save]')!;
const input = (field: string) => $<HTMLInputElement>(`[data-edit-dialog] [data-field="${field}"] input`)!;
const checked = (selector: string) => checkedOf($(`[data-edit-dialog] ${selector}`)!);

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Presses `key` on `el`, as a keyboard does. */
async function press(el: Element, key: string): Promise<void> {
  await settle(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  await settle(() => el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })));
}

/** Opens Settings › Repositories over `board` and presses `repo`'s Edit. */
async function openEdit(repo = REPO, board: BoardData = sample): Promise<void> {
  await mountPage(board);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  const row = $(`.settings-row[data-row="repo-${repo}"]`)!;
  await settle(() => [...row.querySelectorAll('button')].find((b) => text(b) === 'Edit')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

test("Edit opens with the default branch's item source, show setting, role and custom labels, and the labels the repository has", async () => {
  const sent = serve();
  await openEdit();
  expect(sent['/api/repositories/config']).toEqual([{ repo: REPO }]);
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe(`Edit ${REPO}`);
  expect(text(document.getElementById(dialog()!.getAttribute('aria-labelledby')!)), 'the title names the dialog').toBe(`Edit ${REPO}`);
  expect(text($('[data-edit-dialog] [data-item-source]'))).toContain("This repository's GitHub issues.");
  expect($('[data-edit-dialog] [data-choice="issues"]')).toBeNull();
  expect(input('role').value).toBe('Backend API server');
  expect(input('project-owner')).toBeNull();
  expect(checked('[data-choice="all"] [role="radio"]')).toBe('true');
  expect($$('[data-edit-dialog] [data-custom]').map((li) => [li.getAttribute('data-custom'), checkedOf(li.querySelector('input[type="checkbox"]')!)]))
    .toEqual([['area: server', 'true'], ['area: web', 'false']]);
  expect(save().disabled, 'nothing changed yet').toBe(true);
  expect(text(dialog()!.querySelector('[data-no-changes]'))).toBe('No changes yet');
  await type(input('role'), 'API server');
  expect(dialog()!.querySelector('[data-no-changes]')).toBeNull();
  await type(input('role'), 'Backend API server');
  expect(text(dialog()!.querySelector('[data-no-changes]')), 'back to the file\'s values').toBe('No changes yet');
});

test('a field problem holds Save as it holds Next in onboarding', async () => {
  serve();
  await openEdit();
  await type(input('role'), ' ');
  expect(save().disabled).toBe(true);
  expect(text($('[data-edit-dialog] [data-field="role"] [data-problem]'))).toBe('Describe what this repository does to continue with Save.');
  await type(input('role'), 'API server');
  expect(save().disabled).toBe(false);
});

test('Save sends the answers with the labels picked and typed, then closes, says where the PR is and shows it on the row', async () => {
  const sent = serve(undefined, { body: { prUrl: PR, error: null, board: { ...sample, repos: sample.repos.map((r) => r.repo === REPO ? { ...r, editPr: PR } : r) } } });
  await openEdit();
  await settle(() => $('[data-edit-dialog] [data-custom="area: web"] input[type="checkbox"]')!.click());
  await type($<HTMLInputElement>('[data-edit-dialog] [data-new-custom]')!, 'area: docs');
  await settle(() => $<HTMLButtonElement>('[data-edit-dialog] [data-add-custom]')!.click());
  expect(sent['/api/onboarding/labels/custom'], 'Add creates nothing until Save').toBeUndefined();
  await settle(() => save().click());
  expect(sent['/api/repositories/config/pr']).toEqual([{ repo: REPO, config: {
    itemSource: CONFIG.itemSource, show: 'all', role: 'Backend API server', labels: ['area: server', 'area: web', 'area: docs'] } }]);
  await settle(() => vi.advanceTimersByTime(500));
  expect(dialog()).toBeNull();
  expect(toast()!.querySelector('a')!.getAttribute('href')).toBe(PR);
  expect($(`.settings-row[data-row="repo-${REPO}"] [data-edit-pr]`)!.getAttribute('href')).toBe(PR);
});

test("Edit with an Edit PR open says its values come from that PR, and Save says it added them to it", async () => {
  serve({ body: { config: CONFIG, labels: LABELS, editPr: PR, error: null } });
  await openEdit();
  const note = dialog()!.querySelector('[data-edit-pr]')!;
  expect(text(note)).toBe('These values come from maddec01/lar-server#21, its open Edit PR. Save adds a commit to that PR.');
  expect(note.querySelector('a')!.getAttribute('href')).toBe(PR);
  await type(input('role'), 'API server');
  await settle(() => save().click());
  await settle(() => vi.advanceTimersByTime(500));
  expect(text(toast()!)).toContain('Added the new values to maddec01/lar-server’s Edit PR.');
  expect(toast()!.querySelector('a')!.getAttribute('href')).toBe(PR);
});

test('while Save runs, the fields, choices, custom labels and Cancel are disabled and Esc keeps the dialog open', async () => {
  let answer!: (answer: Answer) => void;
  serve(undefined, new Promise<Answer>((resolve) => { answer = resolve; }));
  await openEdit();
  await type(input('role'), 'API server');
  await settle(() => save().click());
  const cancel = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === 'Cancel')!;
  expect([input('role').matches(':disabled'), $<HTMLInputElement>('[data-edit-dialog] [data-new-custom]')!.matches(':disabled'), cancel.disabled])
    .toEqual([true, true, true]);
  await press($('[data-edit-dialog] [data-choice="opted-in"] [role="radio"]')!, ' ');
  await press($('[data-edit-dialog] [data-custom="area: web"] input[type="checkbox"]')!, ' ');
  expect([checked('[data-choice="all"] [role="radio"]'), checked('[data-custom="area: web"] input[type="checkbox"]')], 'the answers Save sends stay').toEqual(['true', 'false']);
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settle(() => vi.advanceTimersByTime(500));
  expect(dialog()).not.toBeNull();
  await settle(() => answer({ body: { prUrl: PR, error: null } }));
  await settle(() => vi.advanceTimersByTime(500));
  expect(dialog()).toBeNull();
});

test("a Save that fails shows gh's message and keeps the dialog open with the answers", async () => {
  serve(undefined, { status: 502, body: { error: "Couldn't create area: docs in maddec01/lar-server: HTTP 403" } });
  await openEdit();
  await type(input('role'), 'API server');
  await settle(() => save().click());
  expect(text(dialog()!.querySelector('[role="alert"]'))).toContain('HTTP 403');
  expect(input('role').value).toBe('API server');
  expect(save().disabled, 'Save can go again').toBe(false);
});

test("a load that fails shows the server's problem, and Retry reads again", async () => {
  const sent = serve({ status: 409, body: { error: 'maddec01/lar-server has no .lar-factory.json on its default branch.' } });
  await openEdit();
  expect(text(dialog()!.querySelector('[role="alert"]'))).toContain('has no .lar-factory.json');
  expect(save().disabled).toBe(true);
  await settle(() => [...dialog()!.querySelectorAll('button')].find((b) => text(b) === 'Retry')!.click());
  expect(sent['/api/repositories/config']).toHaveLength(2);
});

test('Edit on an Azure DevOps repository offers the team\'s sprint and backlog with its Team, and custom tags, which Save doesn\'t create', async () => {
  const azure = 'contoso/Fabrikam%20Fiber/lar-api';
  const board: BoardData = { ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: azure, role: 'API', labels: [] }] };
  serve({ body: { config: { itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'all', role: 'API', labels: ['app: music'] },
    labels: ['app: music', 'status-list', 'repo-lar-api', 'web'], error: null } }, undefined, board);
  await openEdit(azure, board);
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Edit contoso/Fabrikam Fiber/lar-api');
  expect($('[data-edit-dialog] [data-custom="repo-lar-api"]'), 'a repo- tag routes items; it is no custom tag').toBeNull();
  expect(text($('[data-edit-dialog] [data-item-source]'))).toContain("The team's backlog and current sprint");
  expect($('[data-edit-dialog] [data-choice="issues"]')).toBeNull();
  expect($<HTMLSelectElement>('[data-edit-dialog] [data-field="team"] select')!.value).toBe('Fabrikam Team');
  expect(text($('[data-edit-dialog] [data-custom-labels] h4'))).toBe('Custom tags');
  expect(text(dialog()!.querySelector('#edit-description'))).not.toMatch(/creates the custom labels/);
  await settle(() => $('[data-edit-dialog] [data-custom="web"] input[type="checkbox"]')!.click());
  await settle(() => save().click());
  await settle(() => vi.advanceTimersByTime(500));
  expect(text(toast()!)).toContain('contoso/Fabrikam Fiber/lar-api’s Edit PR');
});


test('Edit can change the team on a combined Azure board without offering a source choice', async () => {
  const config = { ...CONFIG, itemSource: { kind: 'azure-board', team: 'Fabrikam Team' } };
  const repo = 'contoso/Fabrikam/api';
  const board: BoardData = { ...sample, repos: [{ repo, role: 'API', items: 'azure-board', team: 'Fabrikam Team', labels: [] }] };
  const sent = serve({ body: { config, labels: LABELS, error: null } }, undefined, board);
  await openEdit(repo, board);
  expect($('[data-choice="azure-board"]')).toBeNull();
  const team = $<HTMLSelectElement>('[data-edit-dialog] [data-field="team"] select')!;
  await settle(() => { team.value = 'API Team'; team.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(() => save().click());
  expect(sent['/api/repositories/config/pr']).toEqual([{ repo, config: { ...config, itemSource: { kind: 'azure-board', team: 'API Team' } } }]);
});
