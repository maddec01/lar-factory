// Edit in Settings › Repositories: the dialog loads the repository's .lar-factory.json values and labels into
// onboarding's setup fields and custom label picker, holds Save while a field has a problem or nothing changed, saying
// so then, and Save opens the PR, keeping the dialog and its answers with gh's message when that fails.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text, toast } from '../../test/support.ts';
import { WORKFLOW_LABELS } from '@lar-factory/shared';

const REPO = 'maddec01/lar-server';
const PR = 'https://github.com/maddec01/lar-server/pull/21';
const CONFIG = { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', role: 'Backend API server', labels: ['area: server'] };
const LABELS = [...WORKFLOW_LABELS.map((l) => l.name), 'area: server', 'area: web', 'status-list'];

type Answer = { status?: number; body: object };

/**
 * Serves the sample as the board, `load` for Edit's load and `pr` for its Save, once it settles, and returns the bodies
 * each got.
 */
function serve(load: Answer = { body: { config: CONFIG, labels: LABELS, error: null } }, pr: Answer | Promise<Answer> = { body: { prUrl: PR, error: null } }) {
  const sent: Record<string, object[]> = {};
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    const pending = url === '/api/repositories/config' ? load : url === '/api/repositories/config/pr' ? pr : null;
    if (!pending) return new Response(JSON.stringify(sample));
    (sent[url] ??= []).push(JSON.parse(String(init?.body)));
    const answer = await pending;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetchMock);
  return sent;
}

const dialog = () => $('[data-edit-dialog]');
const save = () => $<HTMLButtonElement>('[data-edit-dialog] [data-save]')!;
const input = (field: string) => $<HTMLInputElement>(`[data-edit-dialog] [data-field="${field}"] input`)!;
const checked = (selector: string) => $(`[data-edit-dialog] ${selector}`)!.getAttribute('aria-checked');

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Presses `key` on `el`, as a keyboard does. */
async function press(el: Element, key: string): Promise<void> {
  await settle(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
  await settle(() => el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })));
}

/** Opens Settings › Repositories and presses the repository's Edit. */
async function openEdit(): Promise<void> {
  await mountPage(sample);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  const row = $(`.settings-row[data-row="repo-${REPO}"]`)!;
  await settle(() => [...row.querySelectorAll('button')].find((b) => text(b) === 'Edit')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

test("Edit opens with the default branch's item source, Project, show setting, role and custom labels, and the labels the repository has", async () => {
  const sent = serve();
  await openEdit();
  expect(sent['/api/repositories/config']).toEqual([{ repo: REPO }]);
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe(`Edit ${REPO}`);
  expect(dialog()!.getAttribute('aria-labelledby')).toBe(dialog()!.querySelector('[data-slot="dialog-title"]')!.id);
  expect(checked('[data-choice="github-project"] [role="radio"]')).toBe('true');
  expect([input('project-owner').value, input('project-number').value, input('role').value]).toEqual(['maddec01', '3', 'Backend API server']);
  expect(checked('[data-choice="all"] [role="radio"]')).toBe('true');
  expect($$('[data-edit-dialog] [data-custom]').map((li) => [li.getAttribute('data-custom'), li.querySelector('[role="checkbox"]')!.getAttribute('aria-checked')]))
    .toEqual([['area: server', 'true'], ['area: web', 'false']]);
  expect(save().disabled, 'nothing changed yet').toBe(true);
  expect(text(dialog()!.querySelector('[data-no-changes]'))).toBe('No changes yet');
  await type(input('role'), 'API server');
  expect(dialog()!.querySelector('[data-no-changes]')).toBeNull();
  await type(input('role'), 'Backend API server');
  expect(text(dialog()!.querySelector('[data-no-changes]')), 'back to the file’s values').toBe('No changes yet');
});

test('a field problem holds Save as it holds Next in onboarding', async () => {
  serve();
  await openEdit();
  await type(input('role'), ' ');
  expect(save().disabled).toBe(true);
  expect(text($('[data-edit-dialog] [data-field="role"] [data-problem]'))).toBe('Save needs the repository’s role.');
  await type(input('role'), 'API server');
  await type(input('project-number'), 'x');
  expect(save().disabled).toBe(true);
  await type(input('project-number'), '4');
  expect(save().disabled).toBe(false);
});

test('Save sends the answers with the labels picked and typed, then closes, says where the PR is and shows it on the row', async () => {
  const sent = serve(undefined, { body: { prUrl: PR, error: null, board: { ...sample, repos: sample.repos.map((r) => r.repo === REPO ? { ...r, editPr: PR } : r) } } });
  await openEdit();
  await settle(() => $('[data-edit-dialog] [data-choice="issues"] [role="radio"]')!.click());
  await settle(() => $('[data-edit-dialog] [data-custom="area: web"] [role="checkbox"]')!.click());
  await type($<HTMLInputElement>('[data-edit-dialog] [data-new-custom]')!, 'area: docs');
  await settle(() => $<HTMLButtonElement>('[data-edit-dialog] [data-add-custom]')!.click());
  expect(sent['/api/onboarding/labels/custom'], 'Add creates nothing until Save').toBeUndefined();
  await settle(() => save().click());
  expect(sent['/api/repositories/config/pr']).toEqual([{ repo: REPO, config: {
    itemSource: { kind: 'issues' }, show: 'all', role: 'Backend API server', labels: ['area: server', 'area: web', 'area: docs'] } }]);
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
  await press($('[data-edit-dialog] [data-choice="issues"] [role="radio"]')!, ' ');
  await press($('[data-edit-dialog] [data-custom="area: web"] [role="checkbox"]')!, ' ');
  expect([checked('[data-choice="github-project"] [role="radio"]'), checked('[data-custom="area: web"] [role="checkbox"]')], 'the answers Save sends stay').toEqual(['true', 'false']);
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
