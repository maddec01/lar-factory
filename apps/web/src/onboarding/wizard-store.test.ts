// The onboarding run: its steps, the T3 projects it offers, picking one, moving between the steps, and keeping it
// on the board when the dialog closes, to resume.

import { expect, test, vi } from 'vite-plus/test';
import { fetchMock, sample, settle, toolChecks } from '../../test/support.ts';
import type { BoardData, ProjectChoice, SetupAnswers, SetupCheckId, SetupCheckResult } from '@lar-factory/shared';

const project = (name: string, parts: Partial<ProjectChoice> = {}): ProjectChoice => ({
  id: name, name, folder: `/Users/me/Developer/${name}`, repo: `maddec01/${name}`, provider: 'GitHub', hasConfig: false, onBoard: false, ...parts,
});
/** The setup step's answers before any is given: a GitHub Project of the repository's owner, with All items suggested. */
const SETUP: SetupAnswers = { itemSource: 'github-project', projectOwner: 'maddec01', projectNumber: '', show: 'all', showPicked: false, role: '' };
const PROJECTS = [project('lar-web'), project('lar-server', { onBoard: true }), project('notes', { repo: null, provider: null, hasConfig: null })];

/** The store, fresh, with T3's projects answered by `reply`; each onboarding it keeps is kept. */
async function store(reply: () => Response = () => new Response(JSON.stringify({ projects: PROJECTS }))) {
  fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/repositories' ? new Response(JSON.stringify({ error: null })) : reply());
  const { useWizardStore } = await import('./wizard-store.ts');
  return useWizardStore;
}

test('the steps are the T3 project, Provider and item source, Checks, then Pull request', async () => {
  const { STEPS } = await import('./wizard-store.ts');
  expect(STEPS.map((s) => s.label)).toEqual(['T3 project', 'Provider and item source', 'Checks', 'Pull request']);
});

test("starting a run opens it on the T3 project step and reads T3's projects", async () => {
  const wizard = await store();
  await settle(() => wizard.getState().start());
  expect(wizard.getState().run).toEqual({ step: 'project', done: [], projectId: null, repo: null, provider: null, savedAs: null, setup: null, prUrl: null });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/onboarding/projects']);
  expect(wizard.getState().projects).toEqual({ state: 'loaded', projects: PROJECTS });
});

test('starting a run from an offer opens it with the offered project picked', async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-web', { hasConfig: true })] })));
  const { stepReady } = await import('./wizard-store.ts');
  await settle(() => wizard.getState().start({ projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web' }));
  expect(wizard.getState().run).toEqual({ step: 'project', done: [], projectId: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub', savedAs: null, setup: null, prUrl: null });
  expect(stepReady(wizard.getState().run!, wizard.getState().projects)).toBe(true);
});

test("a project read that fails keeps the server's problem, and Retry reads again", async () => {
  const wizard = await store(() => new Response(JSON.stringify({ error: "Can't read T3 Code's projects at /x" }), { status: 502 }));
  await settle(() => wizard.getState().start());
  expect(wizard.getState().projects).toEqual({ state: 'failed', error: "Can't read T3 Code's projects at /x" });
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ projects: PROJECTS })));
  await settle(() => wizard.getState().loadProjects());
  expect(wizard.getState().projects.state).toBe('loaded');
});

test('Next waits for a project that can be picked, then moves on; Back returns', async () => {
  const wizard = await store();
  const { stepReady } = await import('./wizard-store.ts');
  await settle(() => wizard.getState().start());
  const ready = () => stepReady(wizard.getState().run!, wizard.getState().projects);
  expect(ready()).toBe(false);
  wizard.getState().next();
  expect(wizard.getState().run!.step).toBe('project');

  for (const taken of ['lar-server', 'notes']) {
    wizard.getState().pick(taken);
    expect(wizard.getState().run!.projectId, `${taken} can't be picked`).toBeNull();
  }
  wizard.getState().pick('lar-web');
  expect(ready()).toBe(true);
  wizard.getState().next();
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub', savedAs: null, setup: SETUP, prUrl: null });
  expect(ready(), 'the step waits for its answers').toBe(false);
  wizard.getState().back();
  expect(wizard.getState().run!.step).toBe('project');
});

test('closing before a project is picked drops the run and keeps nothing', async () => {
  const wizard = await store();
  await settle(() => wizard.getState().start());
  await settle(() => wizard.getState().close());
  expect(wizard.getState().run).toBeNull();
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/onboarding/projects']);
});

/** The body of each onboarding the store asked the server to keep. */
const kept = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/repositories')
  .map(([, init]) => JSON.parse(String(init.body)) as object);

test('closing once a project is picked keeps the repository as onboarding, with its step and answers', async () => {
  const wizard = await store();
  await settle(() => wizard.getState().start());
  wizard.getState().pick('lar-web');
  wizard.getState().next();
  await settle(() => wizard.getState().close());
  expect(wizard.getState().run).toBeNull();
  expect(kept()).toEqual([{ repo: 'maddec01/lar-web', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-web', provider: 'GitHub', setup: SETUP } } }]);
});

/** The store with lar-web picked and its setup step open, and whether Next can move past it. */
async function onSetup(projects = PROJECTS) {
  const wizard = await store(() => new Response(JSON.stringify({ projects })));
  const { stepReady } = await import('./wizard-store.ts');
  await settle(() => wizard.getState().start());
  wizard.getState().pick('lar-web');
  wizard.getState().next();
  return { wizard, ready: () => stepReady(wizard.getState().run!, wizard.getState().projects) };
}

test('the suggested show setting follows the item source until one is picked', async () => {
  const { wizard } = await onSetup();
  const setup = () => wizard.getState().run!.setup!;
  wizard.getState().answer({ itemSource: 'issues' });
  expect(setup()).toMatchObject({ itemSource: 'issues', show: 'opted-in', showPicked: false });
  wizard.getState().answer({ itemSource: 'github-project' });
  expect(setup().show).toBe('all');
  wizard.getState().answer({ show: 'opted-in' });
  wizard.getState().answer({ itemSource: 'issues' });
  wizard.getState().answer({ itemSource: 'github-project' });
  expect(setup()).toMatchObject({ itemSource: 'github-project', show: 'opted-in', showPicked: true });
});

test("Next needs a role, and for a GitHub Project an owner's login and a number", async () => {
  const { wizard, ready } = await onSetup();
  wizard.getState().answer({ role: '  ' });
  expect(ready(), 'a blank role').toBe(false);
  wizard.getState().answer({ role: 'Web client' });
  expect(ready(), 'no Project number').toBe(false);
  for (const [projectOwner, projectNumber] of [['maddec01', '0'], ['maddec01', '3.5'], ['-maddec01', '3'], ['', '3']]) {
    wizard.getState().answer({ projectOwner, projectNumber });
    expect(ready(), `${projectOwner} #${projectNumber}`).toBe(false);
  }
  wizard.getState().answer({ projectOwner: 'maddec01', projectNumber: '3' });
  expect(ready()).toBe(true);
  wizard.getState().answer({ itemSource: 'issues', projectNumber: '' });
  expect(ready(), "the repository's issues need no Project").toBe(true);
  wizard.getState().next();
  expect(wizard.getState().run).toMatchObject({ step: 'checks', done: ['project', 'setup'] });
});

test(".lar-factory.json's values pass the step with no answers; an Azure DevOps origin or a file that can't be reused can't", async () => {
  const config = { itemSource: { kind: 'issues' as const }, show: 'opted-in' as const, role: 'Web client' };
  expect((await onSetup([project('lar-web', { hasConfig: true, config })])).ready()).toBe(true);
  for (const parts of [{ provider: 'Azure DevOps' as const, repo: 'Fabrikam/lar-web', hasConfig: null },
    { hasConfig: true, configProblem: '.lar-factory.json isn’t valid JSON.' }, { hasConfig: null }]) {
    const { wizard, ready } = await onSetup([project('lar-web', parts)]);
    wizard.getState().answer({ itemSource: 'issues', role: 'Web client' });
    expect(ready(), JSON.stringify(parts)).toBe(false);
  }
});

const onboardingBoard = (step: string): BoardData => ({ ...sample,
  onboarding: [{ repo: 'maddec01/lar-web', progress: { step, done: ['project'], answers: { projectId: 'lar-web' } } }] });

test('Resume reopens the run on its step with its answers, and its own project can be picked again', async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-web', { onBoard: true }), project('lar-apple')] })));
  const { useBoardStore } = await import('../board/board-store.ts');
  const setup: SetupAnswers = { ...SETUP, itemSource: 'issues', show: 'all', showPicked: true, role: 'Web client' };
  useBoardStore.getState().receive({ ...sample,
    onboarding: [{ repo: 'maddec01/lar-web', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-web', provider: 'GitHub', setup } } }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub', savedAs: 'maddec01/lar-web', setup, prUrl: null });
  expect(wizard.getState().projects.state, "T3's projects are read again").toBe('loaded');
  wizard.getState().back();
  wizard.getState().pick('lar-apple');
  wizard.getState().pick('lar-web');
  expect(wizard.getState().run!.projectId).toBe('lar-web');
});

test('a resumed run that picks another project replaces the onboarding it was kept under', async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-web', { onBoard: true }), project('lar-apple')] })));
  const { useBoardStore } = await import('../board/board-store.ts');
  useBoardStore.getState().receive(onboardingBoard('project'));
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  wizard.getState().pick('lar-apple');
  await settle(() => wizard.getState().close());
  expect(kept()).toEqual([{ repo: 'maddec01/lar-apple', replaces: 'maddec01/lar-web',
    progress: { step: 'project', done: ['project'], answers: { projectId: 'lar-apple', provider: 'GitHub' } } }]);
});

test("a stored step the dialog doesn't have resumes on the T3 project step", async () => {
  const wizard = await store();
  const { useBoardStore } = await import('../board/board-store.ts');
  useBoardStore.getState().receive({ ...onboardingBoard('cleanup'), onboarding: [{ repo: 'maddec01/lar-web',
    progress: { step: 'cleanup', done: ['project', 'cleanup'], answers: { projectId: 'lar-web' } } }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(wizard.getState().run).toMatchObject({ step: 'project', done: ['project'] });
});

test('a project read that answers after the run closed changes nothing', async () => {
  let answer: (r: Response) => void = () => {};
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
  const { useWizardStore: wizard } = await import('./wizard-store.ts');
  wizard.getState().start();
  wizard.getState().close();
  await settle(() => answer(new Response(JSON.stringify({ projects: PROJECTS }))));
  expect(wizard.getState().projects).toEqual({ state: 'loading' });
});

/** The store, fresh, whose project reads answer PROJECTS and whose project creation answers `created`. */
async function creatingStore(created: () => Response) {
  const wizard = await store();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST' && url === '/api/onboarding/projects' ? created()
    : new Response(JSON.stringify({ projects: PROJECTS })));
  await settle(() => wizard.getState().start());
  return wizard;
}

const added = project('lar-apple', { folder: '/Users/me/Developer/lar-apple' });

test('Create a new T3 project adds the folder, then picks the new project', async () => {
  const wizard = await creatingStore(() => new Response(JSON.stringify({ projects: [...PROJECTS, added], projectId: 'lar-apple', error: null })));
  wizard.getState().pick('lar-web');
  wizard.getState().chooseNew();
  expect(wizard.getState().run).toMatchObject({ projectId: null, repo: null });
  wizard.getState().setFolder('~/Developer/lar-apple');
  await settle(() => wizard.getState().createProject());
  const posts = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([, init]) => init?.method === 'POST');
  expect(posts.map(([url, init]) => [url, JSON.parse(String(init.body))])).toEqual([['/api/onboarding/projects', { folder: '~/Developer/lar-apple' }]]);
  expect(wizard.getState().projects).toEqual({ state: 'loaded', projects: [...PROJECTS, added] });
  expect(wizard.getState().run).toMatchObject({ projectId: 'lar-apple', repo: 'maddec01/lar-apple' });
  expect(wizard.getState().creating).toBeNull();
});

test('a failing t3 project add keeps the folder on the step with its message', async () => {
  const wizard = await creatingStore(() => new Response(JSON.stringify({ error: 't3 could not add the project: Could not reach the T3 Code server.' }), { status: 502 }));
  wizard.getState().chooseNew();
  wizard.getState().setFolder('~/Developer/lar-apple');
  await settle(() => wizard.getState().createProject());
  expect(wizard.getState().creating).toEqual({ folder: '~/Developer/lar-apple', adding: false,
    error: 't3 could not add the project: Could not reach the T3 Code server.' });
  expect(wizard.getState().run).toMatchObject({ step: 'project', projectId: null });
  expect(wizard.getState().projects).toEqual({ state: 'loaded', projects: PROJECTS });
});

test("a new project that can't be picked stays on the form with the reason", async () => {
  const bare = project('notes-2', { repo: null, provider: null, hasConfig: null });
  const wizard = await creatingStore(() => new Response(JSON.stringify({ projects: [...PROJECTS, bare], projectId: 'notes-2', error: null })));
  wizard.getState().chooseNew();
  wizard.getState().setFolder('/Users/me/notes-2');
  await settle(() => wizard.getState().createProject());
  expect(wizard.getState().run).toMatchObject({ projectId: null });
  expect(wizard.getState().creating).toEqual({ folder: '/Users/me/notes-2', adding: false,
    error: "T3 Code added the project, but it can't be picked: Its folder is no main checkout with a GitHub or Azure DevOps origin." });
});

const PASS: SetupCheckResult = { passed: true, detail: 'fine' };
const json = (body: object) => new Response(JSON.stringify(body));

/**
 * The store, fresh, with `projects` as T3's, the commands rechecked as `tools`, each setup check answered from `results`
 * (passing when it isn't named) and Finish answered with `finish`.
 */
async function checkingStore(projects: ProjectChoice[], results: Partial<Record<SetupCheckId, SetupCheckResult>> = {},
  tools = toolChecks(), finish: object = { board: { ...sample, onboarding: [] }, error: null }) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/onboarding/projects') return json({ projects });
    if (url === '/api/recheck') return json({ board: { ...sample, tools }, error: null });
    if (url === '/api/onboarding/checks') return json({ result: results[(JSON.parse(String(init!.body)) as { check: SetupCheckId }).check] ?? PASS, error: null });
    if (url === '/api/onboarding/finish') return json(finish);
    return json({ error: null });
  });
  const { useWizardStore } = await import('./wizard-store.ts');
  return useWizardStore;
}

/** Picks `name`, passes the setup step, with the repository's issues and a role when it asks, and waits for the checks. */
async function toChecks(wizard: Awaited<ReturnType<typeof checkingStore>>, name: string): Promise<void> {
  await settle(() => wizard.getState().start());
  wizard.getState().pick(name);
  wizard.getState().next();
  wizard.getState().answer({ itemSource: 'issues', role: 'Web client' });
  wizard.getState().next();
  await vi.waitFor(() => expect(wizard.getState().checks?.setup.push.state).toBe('done'));
}

const checkPosts = () => (fetchMock.mock.calls as unknown as [string, RequestInit?][])
  .filter(([url]) => url === '/api/recheck' || url === '/api/onboarding/checks').map(([url, init]) => url === '/api/recheck' ? 'recheck' : JSON.parse(String(init!.body)));

test('reaching Checks runs the command checks, then each setup check with the repository, T3 project and item source', async () => {
  const wizard = await checkingStore([project('lar-web')]);
  const { stepReady } = await import('./wizard-store.ts');
  await toChecks(wizard, 'lar-web');
  const sent = { repo: 'maddec01/lar-web', projectId: 'lar-web', itemSource: { kind: 'issues' } };
  expect(checkPosts()).toEqual(['recheck', { check: 'checkout', ...sent }, { check: 'source', ...sent }, { check: 'push', ...sent }]);
  const { run, projects, checks } = wizard.getState();
  expect(checks!.commands).toEqual({ state: 'done' });
  expect(stepReady(run!, projects, checks, toolChecks())).toBe(true);
});

test('a failed check holds Next until its Retry passes, and Retry reruns only that check', async () => {
  const failed: SetupCheckResult = { passed: false, problem: "gh's login can't push to maddec01/lar-web.", fix: 'Get write access.', command: 'gh auth login' };
  const wizard = await checkingStore([project('lar-web')], { push: failed });
  const { stepReady } = await import('./wizard-store.ts');
  await toChecks(wizard, 'lar-web');
  const ready = () => stepReady(wizard.getState().run!, wizard.getState().projects, wizard.getState().checks, toolChecks());
  expect(wizard.getState().checks!.setup.push).toEqual({ state: 'done', result: failed });
  expect(ready()).toBe(false);
  wizard.getState().next();
  expect(wizard.getState().run!.step).toBe('checks');

  fetchMock.mockClear();
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/checks' ? json({ result: PASS, error: null }) : served(url, init));
  await settle(() => wizard.getState().retryCheck('push'));
  expect(checkPosts().map((p) => p.check)).toEqual(['push']);
  expect(ready()).toBe(true);
});

test('a failing command holds Next; gh without the project scope passes only for issues', async () => {
  const { checksPassed } = await import('./wizard-store.ts');
  const checks = { commands: { state: 'done' as const }, setup: { checkout: { state: 'done' as const, result: PASS }, source: { state: 'done' as const, result: PASS },
    push: { state: 'done' as const, result: PASS } }, finishing: false, finishError: null };
  const noScope = toolChecks({ gh: { result: 'no-project-scope', fix: 'gh auth refresh -s project' } });
  expect(checksPassed(checks, noScope, { kind: 'issues' })).toBe(true);
  expect(checksPassed(checks, noScope, { kind: 'github-project', owner: 'maddec01', number: 3 })).toBe(false);
  expect(checksPassed(checks, toolChecks({ t3: { result: 'not-running' } }), { kind: 'issues' })).toBe(false);
  expect(checksPassed({ ...checks, commands: { state: 'running' } }, toolChecks(), { kind: 'issues' })).toBe(false);
});

const REUSED = project('lar-web', { hasConfig: true, config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', role: 'Web client' } });

test("a reused .lar-factory.json's item source is the one checked, and Finish ends the run with no PR and keeps nothing", async () => {
  const wizard = await checkingStore([REUSED]);
  await toChecks(wizard, 'lar-web');
  expect(checkPosts()[2]).toMatchObject({ check: 'source', itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 } });
  const { finishesOnChecks } = await import('./wizard-store.ts');
  expect(finishesOnChecks(wizard.getState().run!, wizard.getState().projects)).toBe(true);
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks() }));
  await settle(() => wizard.getState().finish());
  const posts = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([url]) => url.startsWith('/api/onboarding/finish') || url === '/api/onboarding/repositories');
  expect(posts.map(([url, init]) => [url, JSON.parse(String(init!.body))])).toEqual([['/api/onboarding/finish', { repo: 'maddec01/lar-web' }]]);
  expect(wizard.getState().run).toBeNull();
});

test("Finish that the board refuses keeps the run on Checks with the board's reason", async () => {
  const wizard = await checkingStore([REUSED], {}, toolChecks(), { error: 'maddec01/lar-web has no .lar-factory.json on its default branch to reuse.' });
  await toChecks(wizard, 'lar-web');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks() }));
  await settle(() => wizard.getState().finish());
  expect(wizard.getState().run!.step).toBe('checks');
  expect(wizard.getState().checks).toMatchObject({ finishing: false, finishError: 'maddec01/lar-web has no .lar-factory.json on its default branch to reuse.' });
});

test('Resume on the Checks step runs the checks again once it has read the projects', async () => {
  const wizard = await checkingStore([project('lar-web')]);
  const { useBoardStore } = await import('../board/board-store.ts');
  const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web', setup: { ...SETUP, itemSource: 'issues' as const, role: 'Web client' } } };
  useBoardStore.getState().receive({ ...sample, onboarding: [{ repo: 'maddec01/lar-web', progress }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  await vi.waitFor(() => expect(wizard.getState().checks?.setup.push.state).toBe('done'));
  expect(checkPosts()[0]).toBe('recheck');
});

const PR = 'https://github.com/maddec01/lar-web/pull/14';
const SETUP_DONE = { ...SETUP, itemSource: 'issues' as const, show: 'opted-in' as const, role: 'Web client' };
/** lar-web still onboarding, kept on the Pull request step with its PR. */
const ON_PR = { repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web', provider: 'GitHub' as const, setup: SETUP_DONE }, prUrl: PR } };

/** The store on the Pull request step of lar-web, with the PR opening answered by `opened`. */
async function onPr(opened: object = { prUrl: PR, board: { ...sample, onboarding: [ON_PR] }, error: null }) {
  const wizard = await checkingStore([project('lar-web')]);
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr' ? json(opened) : served(url, init));
  await toChecks(wizard, 'lar-web');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks() }));
  wizard.getState().next();
  return { wizard, useBoardStore };
}

const prPosts = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/pr')
  .map(([, init]) => JSON.parse(String(init.body)) as object);

test("passing Checks with a new file moves to the Pull request step, and Open the PR sends the run's progress and .lar-factory.json's values", async () => {
  const { wizard } = await onPr();
  expect(wizard.getState().run!.step).toBe('pr');
  await settle(() => wizard.getState().openPr());
  expect(prPosts()).toEqual([{ repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web', provider: 'GitHub', setup: SETUP_DONE } },
    config: { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client' } }]);
  expect(wizard.getState().run).toMatchObject({ step: 'pr', prUrl: PR, savedAs: 'maddec01/lar-web' });
  expect(wizard.getState().pr).toEqual({ opening: false, reopening: false, checking: false, checkedAt: null, error: null });
});

test("a PR the board can't open keeps the step with gh's message, and Retry opens it", async () => {
  const { wizard } = await onPr({ error: "Can't open maddec01/lar-web's onboarding PR: gh pr create failed: HTTP 403" });
  await settle(() => wizard.getState().openPr());
  expect(wizard.getState().run).toMatchObject({ step: 'pr', prUrl: null });
  expect(wizard.getState().pr).toEqual({ opening: false, reopening: false, checking: false, checkedAt: null, error: "Can't open maddec01/lar-web's onboarding PR: gh pr create failed: HTTP 403" });
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr'
    ? json({ prUrl: PR, board: { ...sample, onboarding: [ON_PR] }, error: null }) : served(url, init));
  await settle(() => wizard.getState().openPr());
  expect(wizard.getState().run!.prUrl).toBe(PR);
  expect(prPosts()).toHaveLength(2);
});

test('closing with the PR open keeps it, and Resume reopens the step with its PR', async () => {
  const { wizard, useBoardStore } = await onPr();
  await settle(() => wizard.getState().openPr());
  await settle(() => wizard.getState().close());
  expect(kept()).toEqual([ON_PR]);
  useBoardStore.getState().receive({ ...sample, onboarding: [ON_PR] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(wizard.getState().run).toMatchObject({ step: 'pr', prUrl: PR });
});

test('once the board finishes the onboarding its PR merged, the run is onboarded and closing keeps nothing', async () => {
  const { wizard, useBoardStore } = await onPr();
  const { onboarded } = await import('./wizard-store.ts');
  await settle(() => wizard.getState().openPr());
  expect(onboarded(wizard.getState().run!, useBoardStore.getState().data)).toBe(false);
  useBoardStore.getState().receive({ ...sample, onboarding: [] });
  expect(onboarded(wizard.getState().run!, useBoardStore.getState().data)).toBe(true);
  await settle(() => wizard.getState().close());
  expect(kept()).toEqual([]);
});

/** ON_PR as the board has it once it found the PR closed without merging. */
const CLOSED = { ...ON_PR, progress: { ...ON_PR.progress, prClosed: true as const } };

/** The store on lar-web's Pull request step with its PR open, then found closed; `reopened` answers Reopen PR. */
async function closedPr(reopened: object = { board: { ...sample, onboarding: [ON_PR] }, error: null }) {
  const { wizard, useBoardStore } = await onPr();
  await settle(() => wizard.getState().openPr());
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr/reopen' ? json(reopened) : served(url, init));
  const { prClosed } = await import('./wizard-store.ts');
  expect(prClosed(wizard.getState().run!, useBoardStore.getState().data)).toBe(false);
  useBoardStore.getState().receive({ ...sample, onboarding: [CLOSED] });
  expect(prClosed(wizard.getState().run!, useBoardStore.getState().data)).toBe(true);
  return { wizard, useBoardStore, prClosed };
}

test('Reopen PR asks the board to reopen the closed PR, which then waits for its merge again', async () => {
  const { wizard, useBoardStore, prClosed } = await closedPr();
  await settle(() => wizard.getState().reopenPr());
  const posts = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/pr/reopen');
  expect(posts.map(([, init]) => JSON.parse(String(init.body)))).toEqual([{ repo: 'maddec01/lar-web' }]);
  expect(prClosed(wizard.getState().run!, useBoardStore.getState().data)).toBe(false);
  expect(wizard.getState().run).toMatchObject({ step: 'pr', prUrl: PR });
  expect(wizard.getState().pr).toEqual({ opening: false, reopening: false, checking: false, checkedAt: null, error: null });
});

test("a Reopen PR the board refuses keeps the PR closed with gh's message", async () => {
  const error = "Can't reopen maddec01/lar-web's onboarding PR: gh pr reopen failed: HTTP 403";
  const { wizard, useBoardStore, prClosed } = await closedPr({ error });
  await settle(() => wizard.getState().reopenPr());
  expect(prClosed(wizard.getState().run!, useBoardStore.getState().data)).toBe(true);
  expect(wizard.getState().pr).toEqual({ opening: false, reopening: false, checking: false, checkedAt: null, error });
});

test('Start over drops the closed PR and opens a new one, sending no PR with the progress', async () => {
  const { wizard } = await closedPr();
  const NEXT = 'https://github.com/maddec01/lar-web/pull/15';
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr'
    ? json({ prUrl: NEXT, board: { ...sample, onboarding: [{ ...ON_PR, progress: { ...ON_PR.progress, prUrl: NEXT } }] }, error: null }) : served(url, init));
  await settle(() => wizard.getState().startOver());
  expect(prPosts().at(-1)).toMatchObject({ repo: 'maddec01/lar-web', progress: { step: 'pr', answers: { projectId: 'lar-web' } } });
  expect(prPosts().at(-1)).not.toHaveProperty('progress.prUrl');
  expect(wizard.getState().run).toMatchObject({ step: 'pr', prUrl: NEXT });
});

test('Reopen PR and Start over do nothing while the PR is open', async () => {
  const { wizard } = await onPr();
  await settle(() => wizard.getState().openPr());
  fetchMock.mockClear();
  await settle(() => wizard.getState().reopenPr());
  await settle(() => wizard.getState().startOver());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(wizard.getState().run!.prUrl).toBe(PR);
});
