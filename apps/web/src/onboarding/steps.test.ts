// The T3 project step: T3's projects, each with its provider and whether its repository has .lar-factory.json, and
// the ones that can't be picked. The Provider and item source step: the provider, then the item source, show setting
// and role, or the values of a .lar-factory.json it reuses. The Checks step: each check with its state, a failure's
// fix with Retry, and Finish for a reused .lar-factory.json. The Pull request step: the file it adds, Open the PR,
// gh's message with Retry, and the wait for the merge.

import { expect, test, vi } from 'vite-plus/test';
import type { ProjectChoice, SetupCheckId, SetupCheckResult } from '@lar-factory/shared';
import { $, fetchMock, sample, settle, text, toolChecks } from '../../test/support.ts';
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

/** Answers the command recheck with `tools` and each setup check from `results`, passing when it isn't named. */
function answerChecks(results: Partial<Record<SetupCheckId, SetupCheckResult>> = {}, tools = toolChecks()): void {
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/recheck') return new Response(JSON.stringify({ board: { ...sample, tools }, error: null }));
    if (url === '/api/onboarding/checks') {
      const { check } = JSON.parse(String(init!.body)) as { check: SetupCheckId };
      return new Response(JSON.stringify({ result: results[check] ?? { passed: true, detail: `${check} is fine` }, error: null }));
    }
    return served(url);
  });
}

const checkRow = (id: string) => dialog()!.querySelector<HTMLElement>(`[data-check="${id}"]`)!;
const footerButton = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')].find((b) => text(b).trim().startsWith(label));

/** Moves from the Provider and item source step, answered or reused, to Checks, and waits for the checks. */
async function openChecks(): Promise<void> {
  await settle(() => nextButton().click());
  await vi.waitFor(() => expect(checkRow('push').dataset.status).not.toMatch(/waiting|running/));
  await settle();
}

test('the Checks step lists the command checks, then the setup checks, each with its state', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  answerChecks({}, toolChecks({ gh: { result: 'ok', version: '2.96.1' } }));
  await openChecks();
  const ids = [...dialog()!.querySelectorAll<HTMLElement>('[data-check]')].map((r) => r.dataset.check);
  expect(ids).toEqual(['gh', 't3', 'git', 'jq', 'curl', 'checkout', 'source', 'push']);
  expect(ids.map((id) => checkRow(id!).dataset.status)).toEqual(Array(8).fill('passed'));
  expect(text(checkRow('gh'))).toContain('Signed in');
  expect(text(checkRow('source'))).toContain('source is fine');
  expect(dialog()!.querySelector('[data-slot="dialog-panel"] [role="progressbar"]')!.getAttribute('aria-label')).toBe('8 of 8 passed');
  expect(nextButton().disabled).toBe(false);
});

test('a failed check shows its problem, fix and Retry, and Next stays disabled until Retry passes', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  answerChecks({ push: { passed: false, problem: "gh's login can't push to maddec01/lar-web.", fix: 'Get write access, or log gh in as an account that has it:', command: 'gh auth login' } },
    toolChecks({ jq: { result: 'missing', fix: 'brew install jq' } }));
  await openChecks();
  expect(checkRow('jq').dataset.status).toBe('failed');
  expect(text(checkRow('jq'))).toContain('brew install jq');
  const push = checkRow('push');
  expect(push.dataset.status).toBe('failed');
  for (const part of ["gh's login can't push to maddec01/lar-web.", 'Get write access', 'gh auth login']) expect(text(push)).toContain(part);
  expect(nextButton().disabled).toBe(true);

  answerChecks();
  await settle(() => [...push.querySelectorAll('button')].find((b) => text(b).trim() === 'Retry')!.click());
  await vi.waitFor(() => expect(checkRow('push').dataset.status).toBe('passed'));
  expect(nextButton().disabled, 'jq still fails').toBe(true);
  await settle(() => [...checkRow('jq').querySelectorAll('button')].find((b) => text(b).trim() === 'Retry')!.click());
  await vi.waitFor(() => expect(checkRow('jq').dataset.status).toBe('passed'));
  await vi.waitFor(() => expect(checkRow('push').dataset.status).toBe('passed'));
  await settle();
  expect(nextButton().disabled).toBe(false);
});

test('with a reused .lar-factory.json the Checks step ends in Finish, which puts the repository on the board with no PR', async () => {
  await openSetup(project('lar-web', { hasConfig: true,
    config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', role: 'Web client' } }));
  answerChecks();
  await openChecks();
  expect(footerButton('Next'), 'no Pull request step').toBeUndefined();
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/finish'
    ? new Response(JSON.stringify({ board: { ...sample, onboarding: [] }, error: null })) : served(url, init));
  await settle(() => footerButton('Finish')!.click());
  await settle();
  expect(dialog()).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/onboarding/repositories'), 'a finished run is not kept as onboarding').toBe(false);
});

const PR = 'https://github.com/maddec01/lar-web/pull/14';
const prStep = () => dialog()!.querySelector<HTMLElement>('[data-pr-step]')!;
const button = (within: HTMLElement, label: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).trim().startsWith(label));

/** Answers Open the PR with `answer`, a PR's URL or the board's problem. */
function answerPr(answer: { prUrl: string } | { error: string }): void {
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url !== '/api/onboarding/pr') return served(url, init);
    const onboarding = 'prUrl' in answer ? [{ repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web' }, prUrl: PR } }] : [];
    return new Response(JSON.stringify('prUrl' in answer ? { ...answer, board: { ...sample, tools: toolChecks(), onboarding }, error: null } : answer));
  });
}

/** Answers the setup step with the repository's issues and a role, passes Checks and opens the Pull request step. */
async function openPrStep(): Promise<void> {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  answerChecks();
  await openChecks();
  await settle(() => nextButton().click());
}

test('the Pull request step shows the branch and the .lar-factory.json it adds, then Open the PR waits for the merge', async () => {
  await openPrStep();
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('Pull request');
  expect(text(prStep())).toContain('lar-factory/onboarding');
  expect(JSON.parse(text(prStep().querySelector('pre')))).toEqual({ version: 1, role: 'Web client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: [] });
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  expect(prStep().querySelector<HTMLAnchorElement>(`a[href="${PR}"]`)).not.toBeNull();
  expect(text(prStep())).toContain('Waiting for its merge');
  expect(footerButton('Back'), 'an open PR keeps the step').toBeUndefined();
  await settle(() => footerButton('Close and wait')!.click());
  expect(dialog()).toBeNull();
});

test("a PR the board can't open shows gh's message with Retry, and the step stays put", async () => {
  await openPrStep();
  answerPr({ error: "Can't open maddec01/lar-web's onboarding PR: gh pr create failed: HTTP 403" });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  expect(text(prStep())).toContain('gh pr create failed: HTTP 403');
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Retry')!.click());
  await settle();
  expect(prStep().querySelector(`a[href="${PR}"]`)).not.toBeNull();
});

test('once the PR merges the step says the repository is onboarded, and Go to the board closes with nothing to keep', async () => {
  await openPrStep();
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks(), onboarding: [] }));
  expect(text(prStep())).toContain('maddec01/lar-web is onboarded');
  const bar = dialog()!.querySelector('[data-slot="dialog-header"] [data-slot="progress"]')!;
  expect([bar.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), text(bar.querySelector('[data-slot="progress-caption"]'))], 'the Pull request step is done too').toEqual(['4', 'Onboarded']);
  fetchMock.mockClear();
  await settle(() => footerButton('Go to the board')!.click());
  expect(dialog()).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/onboarding/repositories')).toBe(false);
});
