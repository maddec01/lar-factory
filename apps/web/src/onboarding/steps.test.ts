// The T3 project step: T3's projects, each with its provider and whether its repository has .lar-factory.json, and
// the ones that can't be picked. The Provider and item source step: the provider, then the item source, show setting
// and role, or the values of a .lar-factory.json it reuses.

import { expect, test } from 'vite-plus/test';
import type { ProjectChoice } from '@lar-factory/shared';
import { $, fetchMock, sample, settle, text } from '../../test/support.ts';
import { dialog, openOnboarding, project } from './onboarding-support.ts';

const rows = () => [...dialog()!.querySelectorAll<HTMLElement>('[data-choice]')];
const row = (name: string) => rows().find((r) => r.dataset.choice === name)!;
const radio = (name: string) => row(name).querySelector<HTMLElement>('[role="radio"]')!;
const badges = (name: string) => [...row(name).querySelectorAll('[data-slot="badge"]')].map(text);

test('each project shows its folder, repository, provider and whether it has .lar-factory.json', async () => {
  await openOnboarding([
    project('lar-web', { hasConfig: true }),
    project('lar-cli', { hasConfig: false }),
    project('lar-ios', { hasConfig: null }),
    project('lar-api', { repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null }),
  ]);
  expect(rows().map((r) => r.dataset.choice)).toEqual(['lar-web', 'lar-cli', 'lar-ios', 'lar-api', 'new']);
  expect(text(row('lar-web'))).toContain('/Users/me/Developer/lar-web · maddec01/lar-web');
  expect(badges('lar-web')).toEqual(['GitHub', 'has .lar-factory.json']);
  expect(badges('lar-cli')).toEqual(['GitHub', 'no .lar-factory.json']);
  expect(badges('lar-ios')).toEqual(['GitHub', 'couldn’t check .lar-factory.json']);
  expect(badges('lar-api'), 'reading Azure DevOps waits for build #386').toEqual(['Azure DevOps']);
});

test("a repository already on the board, or a folder with no provider's origin, shows but can't be picked", async () => {
  await openOnboarding([
    project('lar-server', { onBoard: true }),
    project('notes', { repo: null, provider: null, hasConfig: null }),
  ]);
  expect(badges('lar-server')).toEqual(['GitHub', 'no .lar-factory.json', 'on the board']);
  expect(text(row('notes'))).toContain('Its folder is no main checkout with a GitHub or Azure DevOps origin.');
  for (const name of ['lar-server', 'notes']) {
    expect(radio(name).getAttribute('aria-disabled') ?? radio(name).hasAttribute('data-disabled').toString(), name).toBe('true');
    await settle(() => radio(name).click());
    expect(radio(name).getAttribute('aria-checked'), name).toBe('false');
  }
});

test("a step that can't read T3's projects shows the problem with Retry", async () => {
  await openOnboarding({ error: "Can't read T3 Code's projects at /x" });
  const alert = dialog()!.querySelector('[role="alert"]')!;
  expect(text(alert)).toContain("Can't read T3 Code's projects at /x");
  expect(text(alert.querySelector('button')).trim()).toBe('Retry');
});

test('with no T3 project the step says so', async () => {
  await openOnboarding([]);
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('T3 Code has no project yet.');
});

test("while T3's projects are read the step shows a spinner", async () => {
  await openOnboarding([project('lar-web')]);
  fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
  const { useWizardStore } = await import('./wizard-store.ts');
  await settle(() => void useWizardStore.getState().loadProjects());
  const reading = dialog()!.querySelector('[data-reading-projects]')!;
  expect(text(reading).trim()).toBe('Reading T3 Code’s projects…');
  expect(reading.querySelector('svg.animate-spin')).not.toBeNull();
});

/** Answers Create a new T3 project's post with `body` and `status`, leaving the other requests as they were served. */
function answerCreate(body: object, status = 200): void {
  const served = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/projects' && init?.method === 'POST'
    ? new Response(JSON.stringify(body), { status }) : served(url));
}

const folderInput = () => dialog()!.querySelector<HTMLInputElement>('[data-new-folder]')!;
const addButton = () => dialog()!.querySelector<HTMLButtonElement>('[data-add-project]')!;

async function typeFolder(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(folderInput(), value);
  await settle(() => folderInput().dispatchEvent(new Event('input', { bubbles: true })));
}

test('Create a new T3 project takes a folder, adds it, and picks the new project', async () => {
  await openOnboarding([project('lar-web')]);
  expect(text(row('new'))).toContain('Create a new T3 project');
  expect(folderInput(), 'the folder shows once the choice is made').toBeNull();
  await settle(() => radio('new').click());
  expect(addButton().disabled, 'Add waits for a folder').toBe(true);
  await typeFolder('~/Developer/lar-apple');
  answerCreate({ projects: [project('lar-web'), project('lar-apple')], projectId: 'lar-apple', error: null });
  await settle(() => addButton().click());
  await settle();
  expect(radio('lar-apple').getAttribute('aria-checked')).toBe('true');
  expect(folderInput()).toBeNull();
});

test("a failing t3 project add shows t3's message and keeps the step", async () => {
  await openOnboarding([project('lar-web')]);
  await settle(() => radio('new').click());
  await typeFolder('/Users/me/lar-apple');
  answerCreate({ error: 't3 could not add the project: Could not reach the T3 Code server.' }, 502);
  await settle(() => addButton().click());
  await settle();
  const alert = dialog()!.querySelector('[role="alert"]')!;
  expect(text(alert)).toContain('t3 could not add the project: Could not reach the T3 Code server.');
  expect(folderInput().value).toBe('/Users/me/lar-apple');
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('T3 project');
});

const field = (name: string) => dialog()!.querySelector<HTMLElement>(`[data-field="${name}"]`);
const input = (name: string) => field(name)?.querySelector<HTMLInputElement>('input') ?? null;
const choice = (name: string) => dialog()!.querySelector<HTMLElement>(`[data-choice="${name}"]`)!;
const nextButton = () => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')].find((b) => text(b).trim().startsWith('Next'))!;

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Opens the dialog with `chosen` as the only T3 project, picks it and moves to the Provider and item source step. */
async function openSetup(chosen: ProjectChoice): Promise<void> {
  await openOnboarding([chosen]);
  await settle(() => radio(chosen.name).click());
  await settle(() => nextButton().click());
}

const suggested = () => [...dialog()!.querySelectorAll('[data-choice]')].filter((c) => text(c).includes('Suggested')).map((c) => (c as HTMLElement).dataset.choice);

test('the step shows the provider read-only, then asks the item source, show setting and role', async () => {
  await openSetup(project('lar-web'));
  expect(text(field('provider'))).toContain('GitHub');
  expect(field('provider')!.querySelector('input, [role="radio"]'), 'the provider has no control').toBeNull();
  expect(input('project-owner')!.value, "the Project's owner starts as the repository's").toBe('maddec01');
  expect(suggested()).toEqual(['all']);
  expect(nextButton().disabled).toBe(true);

  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  expect(input('project-owner'), "the repository's issues need no Project").toBeNull();
  expect(suggested()).toEqual(['opted-in']);
  expect(choice('opted-in').querySelector('[role="radio"]')!.getAttribute('aria-checked'), 'the suggestion applies').toBe('true');

  await type(input('role')!, 'Web client');
  expect(nextButton().disabled).toBe(false);
  expect(dialog()!.querySelector('[data-field="platform"], [data-field="list-group"]')).toBeNull();
});

test('a picked show setting stays when the item source changes', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('opted-in').querySelector<HTMLElement>('[role="radio"]')!.click());
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await settle(() => choice('github-project').querySelector<HTMLElement>('[role="radio"]')!.click());
  expect(choice('opted-in').querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
  expect(suggested(), 'the suggestion is still marked').toEqual(['all']);
  await type(input('project-number')!, '3');
  await type(input('role')!, 'Web client');
  expect(nextButton().disabled).toBe(false);
});

test('a reused .lar-factory.json shows its values and asks nothing', async () => {
  await openSetup(project('lar-web', { hasConfig: true,
    config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'opted-in', role: 'Web client' } }));
  const values = text(dialog()!.querySelector('[data-reused-config]'));
  for (const value of ['GitHub', 'GitHub Project maddec01 #3', 'Opted-in items', 'Web client']) expect(values).toContain(value);
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('build #385');
  expect(dialog()!.querySelector('[data-slot="dialog-panel"] input, [data-slot="dialog-panel"] [role="radio"]')).toBeNull();
  expect(nextButton().disabled).toBe(false);
});

test("a .lar-factory.json that can't be reused shows its problem with Retry, and Next waits", async () => {
  await openSetup(project('lar-web', { hasConfig: true, configProblem: '.lar-factory.json field role is missing or not a string.' }));
  const alert = dialog()!.querySelector('[data-slot="dialog-panel"] [role="alert"]')!;
  expect(text(alert)).toContain('.lar-factory.json field role is missing or not a string.');
  expect(text(alert.querySelector('button')).trim()).toBe('Retry');
  expect(nextButton().disabled).toBe(true);
});

test('an Azure DevOps origin says Azure DevOps arrives in build #386 and offers no item source', async () => {
  await openSetup(project('lar-api', { repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null }));
  expect(text(field('provider'))).toContain('Azure DevOps');
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('build #386');
  expect(dialog()!.querySelector('[data-choice]'), 'no item source').toBeNull();
  expect(nextButton().disabled).toBe(true);
});

test('Resume shows the answers the step had when it closed', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  await settle(() => dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  const { useWizardStore } = await import('./wizard-store.ts');
  const { useBoardStore } = await import('../board/board-store.ts');
  const kept = JSON.parse(String((fetchMock.mock.calls as unknown as [string, RequestInit][])
    .find(([url]) => url === '/api/onboarding/repositories')![1].body)) as { repo: string; progress: never };
  await settle(() => useBoardStore.getState().receive({ ...sample, onboarding: [kept] }));
  await settle(() => useWizardStore.getState().resume('maddec01/lar-web'));
  expect($('[data-onboarding-dialog]')).not.toBeNull();
  expect(input('role')!.value).toBe('Web client');
  expect(choice('issues').querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
});
