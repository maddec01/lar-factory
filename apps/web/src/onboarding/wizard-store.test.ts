// The onboarding run: its steps, the T3 projects it offers, picking one, moving between the steps, and keeping it
// on the board when the dialog closes, to resume.

import { expect, test, vi } from 'vite-plus/test';
import { fetchMock, sample, settle, toolChecks } from '../../test/support.ts';
import type { Clashes } from './wizard-store.ts';
import { STATUS_LABELS, WORKFLOW_LABELS, type BoardData, type BundledSkill, type Clash, type OnboardingRepository, type ClashRun, type ClashRunState, type FixedClashes, type ProjectChoice, type SetupAnswers, type SetupCheckId, type SetupCheckResult } from '@lar-factory/shared';

const project = (name: string, parts: Partial<ProjectChoice> = {}): ProjectChoice => ({
  id: name, name, folder: `/Users/me/Developer/${name}`, repo: `maddec01/${name}`, provider: 'GitHub', hasConfig: false, onBoard: false, ...parts,
});
/** The setup step's answers before any is given: repository issues, with All items suggested. */
const SETUP: SetupAnswers = { itemSource: 'issues', team: '', show: 'all', showPicked: false, role: '' };
const PROJECTS = [project('lar-web'), project('lar-server', { onBoard: true }), project('notes', { repo: null, provider: null, hasConfig: null })];

/** The store, fresh, with T3's projects answered by `reply`; each onboarding it keeps is kept. */
async function store(reply: () => Response = () => new Response(JSON.stringify({ projects: PROJECTS }))) {
  fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/repositories' ? new Response(JSON.stringify({ error: null })) : reply());
  const { useWizardStore } = await import('./wizard-store.ts');
  return useWizardStore;
}

test('the steps are the T3 project, Board settings, Labels, Checks, Cleanup, then Pull request', async () => {
  const { STEPS } = await import('./wizard-store.ts');
  expect(STEPS.map((s) => s.label)).toEqual(['Repository', 'Board settings', 'Labels', 'Checks', 'Cleanup', 'Pull request']);
});

test("starting a run opens it on the T3 project step and reads T3's projects", async () => {
  const wizard = await store();
  await settle(() => wizard.getState().start());
  expect(wizard.getState().run).toEqual({ step: 'project', done: [], projectId: null, repo: null, provider: null, savedAs: null, setup: null, customLabels: [], cleanup: null, prUrl: null });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/onboarding/projects']);
  expect(wizard.getState().projects).toEqual({ state: 'loaded', projects: PROJECTS });
});

test('starting a run from an offer opens it with the offered project picked', async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-web', { hasConfig: true })] })));
  const { stepReady } = await import('./wizard-store.ts');
  await settle(() => wizard.getState().start({ projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub' as const }));
  expect(wizard.getState().run).toEqual({ step: 'project', done: [], projectId: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub', savedAs: null, setup: null, customLabels: [], cleanup: null, prUrl: null });
  expect(stepReady(wizard.getState().run!, wizard.getState().projects)).toBe(true);
});

test("an offered Azure DevOps project's run keeps its provider", async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-api', { repo: 'contoso/Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: true })] })));
  await settle(() => wizard.getState().start({ projectId: 'lar-api', name: 'lar-api', repo: 'contoso/Fabrikam/lar-api', provider: 'Azure DevOps' }));
  expect(wizard.getState().run).toMatchObject({ projectId: 'lar-api', repo: 'contoso/Fabrikam/lar-api', provider: 'Azure DevOps' });
});

test('closing an offered run untouched keeps nothing; once Next moves it or a change, closing keeps it', async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-web', { hasConfig: true }), project('lar-cli')] })));
  const offer = { projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub' as const };
  await settle(() => wizard.getState().start(offer));
  await settle(() => wizard.getState().close());
  expect(kept(), 'nothing kept').toEqual([]);
  await settle(() => wizard.getState().start(offer));
  wizard.getState().next();
  await settle(() => wizard.getState().close());
  await settle(() => wizard.getState().start(offer));
  wizard.getState().pick('lar-cli');
  await settle(() => wizard.getState().close());
  expect(kept().map((body) => (body as { repo: string }).repo)).toEqual(['maddec01/lar-web', 'maddec01/lar-cli']);
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
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub', savedAs: null, setup: SETUP, customLabels: [], cleanup: null, prUrl: null });
  expect(ready(), 'the step waits for its answers').toBe(false);
  wizard.getState().back();
  expect(wizard.getState().run!.step).toBe('project');
});

test('a project whose repository is onboarding already says to use its Resume', async () => {
  const { unpickable } = await import('./wizard-store.ts');
  const run = { step: 'project' as const, done: [], projectId: null, repo: null, provider: null, savedAs: null, setup: null, customLabels: [], cleanup: null, prUrl: null };
  const data = { onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-server' } } }] };
  expect(unpickable(project('lar-server', { onBoard: true }), run, data)).toBe('Setup is already in progress. Close this window and choose Resume.');
  expect(unpickable(project('lar-server', { onBoard: true }), run, { onboarding: [] })).toBe('This repository is already on the board.');
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
  expect(setup()).toMatchObject({ itemSource: 'issues', show: 'all', showPicked: false });
  wizard.getState().answer({ itemSource: 'issues' });
  expect(setup().show).toBe('all');
  wizard.getState().answer({ show: 'opted-in' });
  wizard.getState().answer({ itemSource: 'issues' });
  wizard.getState().answer({ itemSource: 'issues' });
  expect(setup()).toMatchObject({ itemSource: 'issues', show: 'opted-in', showPicked: true });
});

test('GitHub setup needs only a repository description', async () => {
  const { wizard, ready } = await onSetup();
  wizard.getState().answer({ role: '  ' });
  expect(ready()).toBe(false);
  wizard.getState().answer({ role: 'Web client' });
  expect(ready()).toBe(true);
  const { itemSourceOf } = await import('./wizard-store.ts');
  expect(itemSourceOf(wizard.getState().run!, project('lar-web'))).toEqual({ kind: 'issues' });
  wizard.getState().next();
  expect(wizard.getState().run).toMatchObject({ step: 'labels', done: ['project', 'setup'] });
});

test(".lar-factory.json's values pass the step with no answers; a file that can't be read or reused can't", async () => {
  const config = { itemSource: { kind: 'issues' as const }, show: 'opted-in' as const, role: 'Web client', labels: [] };
  expect((await onSetup([project('lar-web', { hasConfig: true, config })])).ready()).toBe(true);
  for (const parts of [{ provider: 'Azure DevOps' as const, repo: 'contoso/Fabrikam/lar-web', hasConfig: null },
    { hasConfig: true, configProblem: '.lar-factory.json isn\'t valid JSON.' }, { hasConfig: null }]) {
    const { wizard, ready } = await onSetup([project('lar-web', parts)]);
    wizard.getState().answer({ itemSource: 'issues', role: 'Web client' });
    expect(ready(), JSON.stringify(parts)).toBe(false);
  }
});

const AZURE = project('lar-web', { repo: 'contoso/Fabrikam/lar-web', provider: 'Azure DevOps' });

test('Azure setup defaults to the combined board without guessing a team', async () => {
  const { wizard } = await onSetup([AZURE]);
  expect(wizard.getState().run!.setup).toEqual({ itemSource: 'azure-board', team: '', show: 'all', showPicked: false, role: '' });
});

test("Next waits for an Azure DevOps sprint's or backlog's team, and the item source names it", async () => {
  const { itemSourceOf } = await import('./wizard-store.ts');
  const { wizard, ready } = await onSetup([AZURE]);
  const source = () => itemSourceOf(wizard.getState().run!, AZURE);
  wizard.getState().answer({ role: 'API server', team: '  ' });
  expect(ready(), 'a blank team').toBe(false);
  expect(source()).toBeNull();
  wizard.getState().answer({ team: ' Fabrikam Team ' });
  expect(ready()).toBe(true);
  expect(source()).toEqual({ kind: 'azure-board', team: 'Fabrikam Team' });
  wizard.getState().answer({ itemSource: 'azure-board' });
  expect(source()).toEqual({ kind: 'azure-board', team: 'Fabrikam Team' });
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
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub', savedAs: 'maddec01/lar-web', setup, customLabels: [], cleanup: null, prUrl: null });
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
  useBoardStore.getState().receive({ ...onboardingBoard('deploy'), onboarding: [{ repo: 'maddec01/lar-web',
    progress: { step: 'deploy', done: ['project', 'deploy'], answers: { projectId: 'lar-web' } } }] });
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

test('Add a folder to T3 Code adds the folder, then picks the new project', async () => {
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
    error: 'T3 Code added the project, but it can\'t be picked: Choose a repository folder connected to GitHub or Azure DevOps.' });
});

const PASS: SetupCheckResult = { passed: true, detail: 'fine' };
/** Every label the Labels step needs, so it lets Next through. */
const EVERY_LABEL = [...WORKFLOW_LABELS, ...STATUS_LABELS].map((l) => l.name);
const json = (body: object) => new Response(JSON.stringify(body));

/** What the fixed checks find when there's nothing to clean up. */
const NONE: FixedClashes = { clashes: [], skillClashes: [], projectSkills: [] };

const OPUS = { instanceId: 'claudeAgent', model: 'claude-opus-4-7' };
/** A Clash agent run that ended with no Clash. */
const DONE: ClashRun = { state: 'done', clashes: [], title: 'Check instructions in maddec01/lar-web (run 1)', threadId: 'thread-1', model: OPUS, startedAt: '2026-10-21T09:50:00Z' };

/**
 * The store, fresh, with `projects` as T3's, the commands rechecked as `tools`, each setup check answered from `results`
 * (passing when it isn't named), the PR's preview with `changes` and the fixed checks with `clashes`.
 */
async function checkingStore(projects: ProjectChoice[], results: Partial<Record<SetupCheckId, SetupCheckResult>> = {},
  tools = toolChecks(), changes: object = { changes: [], error: null }, clashes: object = { ...NONE, error: null }) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/onboarding/projects') return json({ projects });
    if (url === '/api/recheck') return json({ board: { ...sample, tools }, error: null });
    if (url === '/api/onboarding/checks') return json({ result: results[(JSON.parse(String(init!.body)) as { check: SetupCheckId }).check] ?? PASS, error: null });
    if (url === '/api/onboarding/pr/changes') return json(changes);
    if (url === '/api/onboarding/clashes') return json(clashes);
    if (url.startsWith('/api/onboarding/clash-runs')) return json({ runs: [DONE] });
    if (url === '/api/onboarding/labels') return json({ labels: EVERY_LABEL, error: null });
    return json({ error: null });
  });
  const { useWizardStore } = await import('./wizard-store.ts');
  return useWizardStore;
}

/** Picks `name`, passes the setup step, with the repository's issues and a role when it asks, and the Labels step, then waits for the checks. */
async function toChecks(wizard: Awaited<ReturnType<typeof checkingStore>>, name: string): Promise<void> {
  await settle(() => wizard.getState().start());
  wizard.getState().pick(name);
  wizard.getState().next();
  wizard.getState().answer({ itemSource: 'issues', role: 'Web client' });
  wizard.getState().next();
  await vi.waitFor(() => expect(wizard.getState().labels?.read.state).toBe('loaded'));
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
  const recheck = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url === '/api/recheck')!;
  expect(JSON.parse(String(recheck[1].body)), 'a GitHub run asks for gh\'s check').toEqual({ gh: true });
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

test("an Azure DevOps run asks the board for az's check, which holds Next in place of gh's, and checks the team's sprint", async () => {
  const azure = project('lar-api', { repo: 'contoso/Fabrikam/lar-api', provider: 'Azure DevOps' });
  const loggedOut = toolChecks({ gh: { result: 'missing', fix: 'brew install gh' }, az: { result: 'logged-out', fix: 'az login' } });
  const wizard = await checkingStore([azure], {}, loggedOut);
  const { checksPassed, commandChecks } = await import('./wizard-store.ts');
  await settle(() => wizard.getState().start());
  wizard.getState().pick('lar-api');
  wizard.getState().next();
  wizard.getState().answer({ team: 'Fabrikam Team', role: 'API server' });
  wizard.getState().next();
  await settle();
  wizard.getState().next();
  await vi.waitFor(() => expect(wizard.getState().checks?.setup.push.state).toBe('done'));
  const posts = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/recheck' || url === '/api/onboarding/checks')
    .map(([, init]) => JSON.parse(String(init.body)) as object);
  expect(posts[0]).toEqual({ az: true });
  expect(posts[1]).toMatchObject({ check: 'checkout', repo: 'contoso/Fabrikam/lar-api', itemSource: { kind: 'azure-board', team: 'Fabrikam Team' } });
  const sprint = { kind: 'azure-board' as const, team: 'Fabrikam Team' };
  expect(commandChecks(sprint)).toEqual(['az', 't3', 'git', 'jq', 'curl']);
  expect(checksPassed(wizard.getState().checks, loggedOut, sprint), 'az is logged out').toBe(false);
  expect(checksPassed(wizard.getState().checks, toolChecks({ gh: { result: 'missing', fix: 'brew install gh' }, az: { result: 'ok' } }), sprint), 'gh isn\'t needed').toBe(true);
});

const bundled = (name: string): BundledSkill => ({ name, author: 'Lar', licence: 'MIT', source: `https://github.com/maddec01/lar-factory/tree/main/skills/${name}` });
const BUNDLED = ['code-review', 'tdd', 'references/review-checklist.md'].map(bundled);
const CONTEXT: Clash = { id: 'context', file: 'CONTEXT.md', ticked: true, edit: { kind: 'rename', to: 'GLOSSARY.md' }, reason: 'CONTEXT.md is its old name.' };
const SCRATCH: Clash = { id: 'scratch', file: '.scratch/', ticked: false, edit: { kind: 'delete' }, reason: '.scratch/ holds 2 files.' };
const SKILL = { name: 'code-review', path: '.claude/skills/code-review/' };
const FOUND: FixedClashes = { clashes: [CONTEXT, SCRATCH], skillClashes: [SKILL], projectSkills: ['code-review', 'web-deploy'] };

/** Passes Checks with the board's tools and bundled skills, moves to Cleanup and waits for the fixed checks. */
async function toCleanup(wizard: Awaited<ReturnType<typeof checkingStore>>, name: string): Promise<void> {
  await toChecks(wizard, name);
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks(), bundledSkills: BUNDLED }));
  await settle(() => wizard.getState().next());
  await vi.waitFor(() => expect(wizard.getState().clashes?.state).not.toBe('reading'));
  await vi.waitFor(() => expect(wizard.getState().agent.runs ?? wizard.getState().agent.error).not.toBeNull());
}

/** The fixed checks once read. */
function read(clashes: Clashes | null): Extract<Clashes, { state: 'read' }> {
  if (clashes?.state !== 'read') throw new Error(`The fixed checks are ${clashes?.state ?? 'not run'}.`);
  return clashes;
}

const clashPosts = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/clashes')
  .map(([, init]) => JSON.parse(String(init.body)) as object);

test('passing Checks moves to Cleanup, which runs the fixed checks on the repository', async () => {
  const wizard = await checkingStore([project('lar-web')], {}, toolChecks(), undefined, { ...FOUND, error: null });
  await toCleanup(wizard, 'lar-web');
  expect(wizard.getState().run).toMatchObject({ step: 'cleanup', done: ['project', 'setup', 'labels', 'checks'], cleanup: { ticks: {}, skills: {} } });
  expect(clashPosts()).toEqual([{ repo: 'maddec01/lar-web' }]);
  expect(wizard.getState().clashes).toEqual({ state: 'read', found: FOUND, bundled: ['code-review', 'tdd'] });
});

test("each Clash starts ticked as the fixed checks offer it, and a changed tick is kept with the run's progress", async () => {
  const wizard = await checkingStore([project('lar-web')], {}, toolChecks(), undefined, { ...FOUND, skillClashes: [], error: null });
  const { ticked } = await import('./wizard-store.ts');
  await toCleanup(wizard, 'lar-web');
  const ticks = () => [CONTEXT, SCRATCH].map((clash) => ticked(clash, wizard.getState().run!.cleanup));
  expect(ticks(), "CONTEXT.md's rename ticked, .scratch/'s delete not").toEqual([true, false]);
  wizard.getState().tick('context', false);
  wizard.getState().tick('scratch', true);
  expect(ticks()).toEqual([false, true]);
  await settle(() => wizard.getState().close());
  expect(kept()).toMatchObject([{ progress: { step: 'cleanup', answers: { cleanup: { ticks: { context: false, scratch: true }, skills: {} } } } }]);
});

test('a project skill named like a bundled skill holds Next until Delete it, or a rename to a name no other skill has', async () => {
  const wizard = await checkingStore([project('lar-web')], {}, toolChecks(), undefined, { ...FOUND, error: null });
  const { skillProblem, stepReady } = await import('./wizard-store.ts');
  await toCleanup(wizard, 'lar-web');
  const problem = () => skillProblem(SKILL, wizard.getState().run!.cleanup, read(wizard.getState().clashes));
  const ready = () => stepReady(wizard.getState().run!, wizard.getState().projects, wizard.getState().checks, toolChecks(), wizard.getState().clashes, wizard.getState().agent);
  expect([problem(), ready()]).toEqual(['Choose whether to remove or rename this skill.', false]);
  for (const [name, why] of [
    ['', 'Use lowercase letters, numbers and single hyphens, such as web-code-review.'],
    ['Web Review', 'Use lowercase letters, numbers and single hyphens, such as web-code-review.'],
    ['tdd', 'tdd is already a bundled skill.'],
    ['web-deploy', 'A local skill already uses web-deploy.'],
  ]) {
    wizard.getState().pickSkill(SKILL.path, { kind: 'rename', name: name! });
    expect([problem(), ready()], name).toEqual([why, false]);
  }
  wizard.getState().pickSkill(SKILL.path, { kind: 'rename', name: 'web-code-review' });
  expect([problem(), ready()]).toEqual([null, true]);
  wizard.getState().pickSkill(SKILL.path, { kind: 'delete' });
  expect([problem(), ready()]).toEqual([null, true]);
});

test('two skill Clashes in one folder renamed to the same name hold Next', async () => {
  const tdd = { name: 'tdd', path: '.claude/skills/tdd/' };
  const mirrored = { name: 'tdd', path: '.agents/skills/tdd/' };
  const wizard = await checkingStore([project('lar-web')], {}, toolChecks(), undefined, { ...FOUND, skillClashes: [SKILL, tdd, mirrored], error: null });
  const { skillProblem } = await import('./wizard-store.ts');
  await toCleanup(wizard, 'lar-web');
  for (const skill of [SKILL, tdd, mirrored]) wizard.getState().pickSkill(skill.path, { kind: 'rename', name: 'web-skill' });
  const problems = () => [SKILL, tdd, mirrored].map((skill) => skillProblem(skill, wizard.getState().run!.cleanup, read(wizard.getState().clashes)));
  expect(problems()).toEqual(['Another skill will use web-skill in this folder.', 'Another skill will use web-skill in this folder.', null]);
});

test("fixed checks the board can't run hold Next with its problem, and Retry runs them again", async () => {
  const wizard = await checkingStore([project('lar-web')], {}, toolChecks(), undefined, { error: "Can't read maddec01/lar-web's default branch: HTTP 502" });
  const { stepReady } = await import('./wizard-store.ts');
  await toCleanup(wizard, 'lar-web');
  expect(wizard.getState().clashes).toEqual({ state: 'failed', error: "Can't read maddec01/lar-web's default branch: HTTP 502" });
  expect(stepReady(wizard.getState().run!, wizard.getState().projects, wizard.getState().checks, toolChecks(), wizard.getState().clashes, wizard.getState().agent)).toBe(false);
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/clashes' ? json({ ...NONE, error: null }) : served(url, init));
  await settle(() => wizard.getState().findClashes());
  expect(wizard.getState().clashes).toMatchObject({ state: 'read', found: NONE });
  expect(stepReady(wizard.getState().run!, wizard.getState().projects, wizard.getState().checks, toolChecks(), wizard.getState().clashes, wizard.getState().agent)).toBe(true);
});

test('Resume on Cleanup brings back the ticks and skill picks, and runs the fixed checks again', async () => {
  const wizard = await checkingStore([project('lar-web', { onBoard: true })], {}, toolChecks(), undefined, { ...FOUND, error: null });
  const { useBoardStore } = await import('../board/board-store.ts');
  const cleanup = { ticks: { scratch: true }, skills: { [SKILL.path]: { kind: 'rename' as const, name: 'web-code-review' } } };
  const progress = { step: 'cleanup', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web', setup: { ...SETUP, itemSource: 'issues' as const, role: 'Web client' }, cleanup } };
  useBoardStore.getState().receive({ ...sample, bundledSkills: BUNDLED, onboarding: [{ repo: 'maddec01/lar-web', progress }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  await vi.waitFor(() => expect(wizard.getState().clashes?.state).toBe('read'));
  expect(wizard.getState().run).toMatchObject({ step: 'cleanup', cleanup });
  expect(clashPosts()).toEqual([{ repo: 'maddec01/lar-web' }]);
});

const REUSED = project('lar-web', { hasConfig: true, config: { itemSource: { kind: 'issues' }, show: 'all', role: 'Web client', labels: ['app: music'] } });

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
const SETUP_DONE = { ...SETUP, itemSource: 'issues' as const, show: 'all' as const, role: 'Web client' };
/** lar-web still onboarding, kept on the Pull request step with its PR. */
const ON_PR = { repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'labels', 'checks', 'cleanup'],
  answers: { projectId: 'lar-web', provider: 'GitHub' as const, setup: SETUP_DONE, cleanup: { ticks: {}, skills: {} } }, prUrl: PR } };

/** The store on the Pull request step of lar-web, with the PR opening answered by `opened`. */
async function onPr(opened: object = { prUrl: PR, board: { ...sample, onboarding: [ON_PR] }, error: null }) {
  const wizard = await checkingStore([project('lar-web')]);
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr' ? json(opened) : served(url, init));
  await toCleanup(wizard, 'lar-web');
  wizard.getState().next();
  const { useBoardStore } = await import('../board/board-store.ts');
  return { wizard, useBoardStore };
}

const prPosts = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/pr')
  .map(([, init]) => JSON.parse(String(init.body)) as object);

test('passing Cleanup with a new file moves to the Pull request step, and Open pull request sends the run\'s progress and .lar-factory.json\'s values', async () => {
  const { wizard } = await onPr();
  expect(wizard.getState().run!.step).toBe('pr');
  await settle(() => wizard.getState().openPr());
  expect(prPosts()).toEqual([{ repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'labels', 'checks', 'cleanup'],
    answers: { projectId: 'lar-web', provider: 'GitHub', setup: SETUP_DONE, cleanup: { ticks: {}, skills: {} } } },
    config: { itemSource: { kind: 'issues' }, show: 'all', role: 'Web client', labels: [] }, picks: { clashes: [], skills: {} } }]);
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

test('once the board finishes the onboarding its PR merged, the run is ready and closing keeps nothing', async () => {
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

test('Reopen pull request asks the board to reopen the closed PR, which then waits for its merge again', async () => {
  const { wizard, useBoardStore, prClosed } = await closedPr();
  await settle(() => wizard.getState().reopenPr());
  const posts = (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/pr/reopen');
  expect(posts.map(([, init]) => JSON.parse(String(init.body)))).toEqual([{ repo: 'maddec01/lar-web' }]);
  expect(prClosed(wizard.getState().run!, useBoardStore.getState().data)).toBe(false);
  expect(wizard.getState().run).toMatchObject({ step: 'pr', prUrl: PR });
  expect(wizard.getState().pr).toEqual({ opening: false, reopening: false, checking: false, checkedAt: null, error: null });
});

test('a Reopen pull request the board refuses keeps the PR closed with gh\'s message', async () => {
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

test('Reopen pull request and Start over do nothing while the PR is open', async () => {
  const { wizard } = await onPr();
  await settle(() => wizard.getState().openPr());
  fetchMock.mockClear();
  await settle(() => wizard.getState().reopenPr());
  await settle(() => wizard.getState().startOver());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(wizard.getState().run!.prUrl).toBe(PR);
});

const CHANGES = [{ kind: 'agent-skills', path: 'AGENTS.md' }, { kind: 'write', path: '.lar-factory.json', created: true }];
const RENAMED = { [SKILL.path]: { kind: 'rename' as const, name: 'web-code-review' } };

/**
 * The store on lar-web's Pull request step after Cleanup with FOUND and the agent's AGENT_CLASH, its skill Clash
 * renamed and .scratch/'s delete ticked; the preview answers `changes` and Open the PR `opened`.
 */
async function pickedPr(projects = [project('lar-web')], opened: object = { prUrl: PR, board: { ...sample, onboarding: [ON_PR] }, error: null },
  changes: object = { changes: CHANGES, error: null }) {
  const wizard = await checkingStore(projects, {}, toolChecks(), changes, { ...FOUND, error: null });
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr' ? json(opened)
    : url.startsWith('/api/onboarding/clash-runs') ? json({ runs: [{ ...DONE, clashes: [AGENT_CLASH] }] }) : served(url, init));
  await toCleanup(wizard, 'lar-web');
  wizard.getState().pickSkill(SKILL.path, RENAMED[SKILL.path]!);
  wizard.getState().tick('scratch', true);
  await settle(() => wizard.getState().next());
  await vi.waitFor(() => expect(wizard.getState().changes?.state).not.toBe('reading'));
  return wizard;
}

const previewPosts = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([url]) => url === '/api/onboarding/pr/changes')
  .map(([, init]) => JSON.parse(String(init.body)) as object);

test("reaching the Pull request step lists the PR's changes, previewed with .lar-factory.json's values and the Cleanup step's picks", async () => {
  const wizard = await pickedPr();
  const picks = { clashes: [CONTEXT, SCRATCH, AGENT_CLASH], skills: RENAMED };
  expect(previewPosts()).toEqual([{ repo: 'maddec01/lar-web', config: { itemSource: { kind: 'issues' }, show: 'all', role: 'Web client', labels: [] }, picks }]);
  expect(wizard.getState().changes).toEqual({ state: 'read', changes: CHANGES });
  await settle(() => wizard.getState().openPr());
  expect(prPosts()).toMatchObject([{ config: { role: 'Web client' }, picks }]);
});

test("a reused .lar-factory.json's run goes on to the Pull request step, which previews and opens the PR with no config to write", async () => {
  const wizard = await pickedPr([REUSED]);
  expect(wizard.getState().run!.step).toBe('pr');
  expect(previewPosts()).toMatchObject([{ repo: 'maddec01/lar-web', config: null }]);
  await settle(() => wizard.getState().openPr());
  expect(prPosts()).toMatchObject([{ repo: 'maddec01/lar-web', config: null, picks: { skills: RENAMED } }]);
  expect(wizard.getState().run!.prUrl).toBe(PR);
});

test('changing a tick after a failed open, then Retry, opens the PR with the new picks and lists them again', async () => {
  const wizard = await pickedPr(undefined, { error: "Can't open maddec01/lar-web's onboarding PR: HTTP 403" });
  await settle(() => wizard.getState().openPr());
  await settle(() => wizard.getState().back());
  await vi.waitFor(() => expect(wizard.getState().clashes?.state).toBe('read'));
  wizard.getState().tick('agent-1', false);
  await settle(() => wizard.getState().next());
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr'
    ? json({ prUrl: PR, board: { ...sample, onboarding: [ON_PR] }, error: null }) : served(url, init));
  await settle(() => wizard.getState().openPr());
  expect(prPosts().map((body) => (body as { picks: { clashes: Clash[] } }).picks.clashes.map((c) => c.id)))
    .toEqual([['context', 'scratch', 'agent-1'], ['context', 'scratch']]);
  expect(previewPosts()).toHaveLength(2);
  expect(wizard.getState().run!.prUrl).toBe(PR);
});

test("a preview the board refuses keeps its problem, and Retry previews again", async () => {
  const wizard = await pickedPr(undefined, undefined, { error: 'CONTEXT.md no longer exists on the default branch.' });
  expect(wizard.getState().changes).toEqual({ state: 'failed', error: 'CONTEXT.md no longer exists on the default branch.' });
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr/changes' ? json({ changes: CHANGES, error: null }) : served(url, init));
  await settle(() => wizard.getState().previewPr());
  expect(wizard.getState().changes).toEqual({ state: 'read', changes: CHANGES });
});

test('a preview with the picked project gone from T3 Code fails with why, rather than reading forever', async () => {
  const wizard = await pickedPr();
  wizard.setState({ projects: { state: 'loaded', projects: [] } });
  await settle(() => wizard.getState().previewPr());
  expect(wizard.getState().changes).toEqual({ state: 'failed', error: 'This project is no longer in T3 Code. Go back and choose another.' });
});

test('Resume on the Pull request step with no PR reads the Clashes again, previews and opens the PR with the kept picks', async () => {
  const wizard = await pickedPr();
  await settle(() => wizard.getState().close());
  const { useBoardStore } = await import('../board/board-store.ts');
  useBoardStore.getState().receive({ ...sample, bundledSkills: BUNDLED, onboarding: kept() as OnboardingRepository[] });
  fetchMock.mockClear();
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect([clashPosts(), wizard.getState().changes], 'the step reads them once it lists the changes').toEqual([[], null]);
  await settle(() => wizard.getState().readPrChanges());
  await vi.waitFor(() => expect(wizard.getState().changes?.state).toBe('read'));
  expect(clashPosts()).toEqual([{ repo: 'maddec01/lar-web' }]);
  expect(previewPosts()).toMatchObject([{ picks: { clashes: [CONTEXT, SCRATCH, AGENT_CLASH], skills: RENAMED } }]);
  await settle(() => wizard.getState().openPr());
  expect(prPosts()).toMatchObject([{ picks: { clashes: [CONTEXT, SCRATCH, AGENT_CLASH], skills: RENAMED } }]);
});

/**
 * The board's Clash agent runs for maddec01/lar-web, which the test ends with `end`: a GET answers them, and a post
 * starts a run that answers with its first message. Each request is recorded.
 */
function agentBoard(runs: ClashRun[] = []) {
  const requests: (string | object)[] = [];
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/onboarding/clash-runs')) return served(url, init);
    if (init?.method !== 'POST') {
      requests.push(url);
      return json({ runs });
    }
    const body = JSON.parse(String(init.body)) as { model: ClashRun['model'] };
    requests.push(body);
    runs.push({ state: 'running', progress: null, title: `Check instructions in maddec01/lar-web (run ${runs.length + 1})`, threadId: null, model: body.model, startedAt: '2026-10-21T10:00:00Z' });
    return json({ runs, error: null });
  });
  const end = (state: ClashRunState) => { const last = runs.at(-1)!; runs[runs.length - 1] = { ...state, title: last.title, threadId: `thread-${runs.length}`, model: last.model, startedAt: last.startedAt }; };
  const progress = (message: string) => { runs[runs.length - 1] = { ...runs.at(-1)!, state: 'running', progress: message, threadId: `thread-${runs.length}` } as ClashRun; };
  return { requests, end, progress, runs };
}

const AGENT_CLASH: Clash = { id: 'agent-1', file: 'AGENTS.md', line: 12, reason: 'It says to push to main.', edit: { kind: 'lines', remove: ['Push to main.'], add: ['Open a PR.'] }, ticked: true };
const GETS = '/api/onboarding/clash-runs?repo=maddec01%2Flar-web';

test('Check instructions starts a run on the picked model, reads it every few seconds while it runs, and Next waits until it is done', async () => {
  const wizard = await checkingStore([project('lar-web')]);
  const { AGENT_POLL_MS, latestRun, stepReady, ticked } = await import('./wizard-store.ts');
  const agent = agentBoard();
  await toCleanup(wizard, 'lar-web');
  const ready = () => stepReady(wizard.getState().run!, wizard.getState().projects, wizard.getState().checks, toolChecks(), wizard.getState().clashes, wizard.getState().agent);
  expect(wizard.getState().agent.runs, 'no run yet').toEqual([]);
  expect(ready()).toBe(false);

  wizard.getState().pickModel(OPUS);
  await settle(() => wizard.getState().lookForClashes(OPUS));
  expect(agent.requests).toEqual([GETS, { repo: 'maddec01/lar-web', projectId: 'lar-web', model: OPUS }]);
  expect(latestRun(wizard.getState().agent)).toMatchObject({ state: 'running', progress: null });
  expect(ready()).toBe(false);

  agent.progress('Reading AGENTS.md');
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS));
  expect(latestRun(wizard.getState().agent)).toMatchObject({ state: 'running', progress: 'Reading AGENTS.md', threadId: 'thread-1' });
  agent.end({ state: 'done', clashes: [AGENT_CLASH] });
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS));
  expect(latestRun(wizard.getState().agent)).toMatchObject({ state: 'done', clashes: [AGENT_CLASH] });
  expect(ready()).toBe(true);
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS * 3));
  expect(agent.requests.filter((r) => r === GETS), 'no read once it is done').toHaveLength(3);

  wizard.getState().tick('agent-1', false);
  expect(ticked(AGENT_CLASH, wizard.getState().run!.cleanup)).toBe(false);
  await settle(() => wizard.getState().close());
  expect(kept()).toMatchObject([{ progress: { step: 'cleanup', answers: { cleanup: { ticks: { 'agent-1': false } } } } }]);
});

test.each([
  ['failed', { state: 'failed', why: 'The agent errored.' }],
  ['waiting', { state: 'waiting', why: 'The agent is waiting for an answer in T3 Code.' }],
  ['timed-out', { state: 'timed-out', why: 'The run took longer than 15 minutes.' }],
] as const)('a %s run holds Next, and Retry starts a new run, keeps the old one listed and drops the agent ticks', async (_, ended) => {
  const wizard = await checkingStore([project('lar-web')]);
  const { latestRun, stepReady } = await import('./wizard-store.ts');
  const agent = agentBoard();
  await toCleanup(wizard, 'lar-web');
  const ready = () => stepReady(wizard.getState().run!, wizard.getState().projects, wizard.getState().checks, toolChecks(), wizard.getState().clashes, wizard.getState().agent);
  await settle(() => wizard.getState().lookForClashes(OPUS));
  agent.end(ended);
  await settle(() => wizard.getState().readClashRuns());
  expect(latestRun(wizard.getState().agent)).toMatchObject(ended);
  expect(ready()).toBe(false);
  wizard.getState().tick('agent-1', false);
  wizard.getState().tick('context', false);

  await settle(() => wizard.getState().lookForClashes(OPUS));
  expect(wizard.getState().agent.runs!.map((r) => r.title)).toEqual(['Check instructions in maddec01/lar-web (run 1)', 'Check instructions in maddec01/lar-web (run 2)']);
  expect(wizard.getState().run!.cleanup!.ticks, "the new run's agent-1 is another Clash").toEqual({ context: false });
  agent.end({ state: 'done', clashes: [] });
  await settle(() => wizard.getState().readClashRuns());
  expect(ready()).toBe(true);
});

test('closing during a run stops reading it, and Resume shows its progress, then its result', async () => {
  const wizard = await checkingStore([project('lar-web', { onBoard: true })]);
  const { AGENT_POLL_MS, latestRun } = await import('./wizard-store.ts');
  const { useBoardStore } = await import('../board/board-store.ts');
  const agent = agentBoard([{ state: 'running', progress: 'Reading CLAUDE.md', title: 'Check instructions in maddec01/lar-web (run 1)', threadId: 'thread-1', model: OPUS, startedAt: '2026-10-21T09:58:00Z' }]);
  const progress = { step: 'cleanup', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web', setup: { ...SETUP, itemSource: 'issues' as const, role: 'Web client' }, cleanup: { ticks: {}, skills: {} } } };
  useBoardStore.getState().receive({ ...sample, bundledSkills: BUNDLED, onboarding: [{ repo: 'maddec01/lar-web', progress }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(latestRun(wizard.getState().agent)).toMatchObject({ state: 'running', progress: 'Reading CLAUDE.md' });

  await settle(() => wizard.getState().close());
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS * 3));
  expect(agent.requests, 'no read once closed').toEqual([GETS]);

  agent.end({ state: 'done', clashes: [AGENT_CLASH] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(latestRun(wizard.getState().agent)).toMatchObject({ state: 'done', clashes: [AGENT_CLASH] });
  expect(agent.requests, 'Resume starts no run').toEqual([GETS, GETS]);
});

/**
 * The store with `projects` as T3's and the repository's labels as `names`; Create and Rename answer with `changed`,
 * or with gh's problem when `failure` is set.
 */
async function labelsStore(projects: ProjectChoice[], names: string[], changed: string[] = EVERY_LABEL, failure: string | null = null) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/onboarding/projects') return json({ projects });
    if (url === '/api/onboarding/labels') return json({ labels: names, error: null });
    if (url.startsWith('/api/onboarding/labels/')) return failure ? new Response(JSON.stringify({ error: failure }), { status: 502 }) : json({ labels: changed, error: null });
    return json({ error: null });
  });
  const { useWizardStore } = await import('./wizard-store.ts');
  return useWizardStore;
}

/** Picks `name`, answers the setup step with the repository's issues when it asks, and waits on the Labels step for the labels. */
async function toLabels(wizard: Awaited<ReturnType<typeof labelsStore>>, name: string): Promise<void> {
  await settle(() => wizard.getState().start());
  wizard.getState().pick(name);
  wizard.getState().next();
  wizard.getState().answer({ itemSource: 'issues', role: 'Web client' });
  wizard.getState().next();
  await settle();
}

const labelPosts = () => (fetchMock.mock.calls as unknown as [string, RequestInit?][])
  .filter(([url]) => url.startsWith('/api/onboarding/labels')).map(([url, init]) => [url, JSON.parse(String(init!.body))]);

test('reaching Labels reads the repository\'s labels, and Next waits while a workflow label is missing', async () => {
  const wizard = await labelsStore([project('lar-web')], ['bug', 'decision: grill']);
  const { stepReady } = await import('./wizard-store.ts');
  await toLabels(wizard, 'lar-web');
  const ready = () => stepReady(wizard.getState().run!, wizard.getState().projects, null, undefined, null, null, wizard.getState().labels);
  expect(wizard.getState().run!.step).toBe('labels');
  expect(labelPosts()).toEqual([['/api/onboarding/labels', { repo: 'maddec01/lar-web' }]]);
  expect(ready()).toBe(false);
  wizard.getState().next();
  expect(wizard.getState().run!.step).toBe('labels');
  await settle(() => wizard.getState().createLabels());
  expect(ready()).toBe(true);
});

test('Create sends the item source and the old names Rename moves; Rename sends each ticked old name', async () => {
  const wizard = await labelsStore([project('lar-web')], ['decision: grill', 'decision: task']);
  await toLabels(wizard, 'lar-web');
  wizard.getState().toggleRename('decision: task');
  await settle(() => wizard.getState().createLabels());
  wizard.getState().toggleRename('decision: task');
  await settle(() => wizard.getState().loadLabels());
  await settle(() => wizard.getState().renameLabels());
  expect(labelPosts().filter(([url]) => url !== '/api/onboarding/labels')).toEqual([
    ['/api/onboarding/labels/create', { repo: 'maddec01/lar-web', itemSource: { kind: 'issues' }, renaming: ['decision: grill'], custom: [] }],
    ['/api/onboarding/labels/rename', { repo: 'maddec01/lar-web', names: ['decision: grill', 'decision: task'] }],
  ]);
});

test("a Create gh refuses keeps gh's message with the action to retry, and reads the labels again", async () => {
  const wizard = await labelsStore([project('lar-web')], ['bug'], EVERY_LABEL, "Couldn't create feature in maddec01/lar-web: HTTP 403");
  await toLabels(wizard, 'lar-web');
  await settle(() => wizard.getState().createLabels());
  expect(wizard.getState().labels).toMatchObject({ busy: null, error: { action: 'create', message: "Couldn't create feature in maddec01/lar-web: HTTP 403" } });
  expect(labelPosts().map(([url]) => url)).toEqual(['/api/onboarding/labels', '/api/onboarding/labels/create', '/api/onboarding/labels']);
});

test("a reused .lar-factory.json passes through Labels too, which waits for its missing labels, and Create makes the file's missing custom labels", async () => {
  const wizard = await labelsStore([REUSED], ['bug']);
  const { stepReady } = await import('./wizard-store.ts');
  await toLabels(wizard, 'lar-web');
  expect(wizard.getState().run!.step).toBe('labels');
  expect(stepReady(wizard.getState().run!, wizard.getState().projects, null, undefined, null, null, wizard.getState().labels)).toBe(false);
  await settle(() => wizard.getState().createLabels());
  expect(labelPosts()[1]).toEqual(['/api/onboarding/labels/create', { repo: 'maddec01/lar-web', itemSource: REUSED.config!.itemSource, renaming: [], custom: ['app: music'] }]);
});

test("Create runs for a reused file's missing custom labels alone, and sends none the repository has", async () => {
  const wizard = await labelsStore([REUSED], EVERY_LABEL, [...EVERY_LABEL, 'app: music']);
  await toLabels(wizard, 'lar-web');
  await settle(() => wizard.getState().createLabels());
  expect(labelPosts()[1]).toEqual(['/api/onboarding/labels/create', { repo: 'maddec01/lar-web', itemSource: REUSED.config!.itemSource, renaming: [], custom: ['app: music'] }]);
  await settle(() => wizard.getState().createLabels());
  expect(labelPosts().length, 'nothing left to create').toBe(2);
});

test("on Azure DevOps the Labels step reads the project's tags, goes on with tags not yet used, and picks a typed custom tag without creating it", async () => {
  const azure = project('lar-api', { repo: 'contoso/Fabrikam/lar-api', provider: 'Azure DevOps' });
  const wizard = await labelsStore([azure], ['bug']);
  await settle(() => wizard.getState().start());
  wizard.getState().pick('lar-api');
  wizard.getState().next();
  wizard.getState().answer({ itemSource: 'azure-board', team: 'Fabrikam Team', role: 'API' });
  wizard.getState().next();
  await settle();
  expect(wizard.getState().run!.step).toBe('labels');
  expect(labelPosts()).toEqual([['/api/onboarding/labels', { repo: 'contoso/Fabrikam/lar-api' }]]);
  await settle(() => wizard.getState().createLabels());
  for (const typed of ['app, music', 'app; music']) {
    wizard.getState().typeCustomLabel(typed);
    await settle(() => wizard.getState().addCustomLabel());
    expect(wizard.getState().run!.customLabels).toEqual([]);
  }
  wizard.getState().typeCustomLabel(' app: music ');
  await settle(() => wizard.getState().addCustomLabel());
  expect(wizard.getState().run!.customLabels).toEqual(['app: music']);
  expect(wizard.getState().labels!.typed).toBe('');
  expect(labelPosts().length, 'no Create and no custom tag post').toBe(1);
  wizard.getState().next();
  expect(wizard.getState().run!.step).toBe('checks');
});

test('Resume on the Labels step reads the labels again once it has read the projects', async () => {
  const wizard = await labelsStore([project('lar-web')], EVERY_LABEL);
  const { useBoardStore } = await import('../board/board-store.ts');
  const progress = { step: 'labels', done: ['project', 'setup'], answers: { projectId: 'lar-web', setup: SETUP_DONE } };
  useBoardStore.getState().receive({ ...sample, onboarding: [{ repo: 'maddec01/lar-web', progress }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  await vi.waitFor(() => expect(wizard.getState().labels?.read.state).toBe('loaded'));
  expect(wizard.getState().run!.step).toBe('labels');
});

test('a picked custom label is kept with the run\'s answers, Resume brings it back, and the PR\'s .lar-factory.json has it', async () => {
  const wizard = await labelsStore([project('lar-web')], [...EVERY_LABEL, 'app: music', 'web']);
  const { configOf } = await import('./wizard-store.ts');
  await toLabels(wizard, 'lar-web');
  wizard.getState().toggleCustomLabel('web');
  wizard.getState().toggleCustomLabel('app: music');
  wizard.getState().toggleCustomLabel('web');
  expect(wizard.getState().run!.customLabels).toEqual(['app: music']);
  expect(configOf(wizard.getState().run!, project('lar-web'))!.labels).toEqual(['app: music']);
  await settle(() => wizard.getState().close());
  const { progress } = kept().at(-1) as { progress: { answers: object } };
  expect(progress.answers).toMatchObject({ customLabels: ['app: music'] });
  const { useBoardStore } = await import('../board/board-store.ts');
  useBoardStore.getState().receive({ ...sample, onboarding: [{ repo: 'maddec01/lar-web', progress: progress as never }] });
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(wizard.getState().run!.customLabels).toEqual(['app: music']);
});

test('a typed custom label, colon and all, is created on the repository and picked', async () => {
  const wizard = await labelsStore([project('lar-web')], EVERY_LABEL, [...EVERY_LABEL, 'app: music']);
  await toLabels(wizard, 'lar-web');
  wizard.getState().typeCustomLabel(' app: music ');
  await settle(() => wizard.getState().addCustomLabel());
  expect(labelPosts().at(-1)).toEqual(['/api/onboarding/labels/custom', { repo: 'maddec01/lar-web', name: 'app: music' }]);
  expect(wizard.getState().run!.customLabels).toEqual(['app: music']);
  expect(wizard.getState().labels).toMatchObject({ typed: '', created: ['app: music'], busy: null, error: null });
});

test("a typed label that is a workflow label sends nothing, and one gh refuses keeps gh's message and the name it was adding until the field changes", async () => {
  const wizard = await labelsStore([project('lar-web')], EVERY_LABEL, EVERY_LABEL, "Couldn't create web in maddec01/lar-web: HTTP 403");
  await toLabels(wizard, 'lar-web');
  wizard.getState().typeCustomLabel('build');
  await settle(() => wizard.getState().addCustomLabel());
  expect(labelPosts().map(([url]) => url)).toEqual(['/api/onboarding/labels']);
  wizard.getState().typeCustomLabel('web');
  await settle(() => wizard.getState().addCustomLabel());
  expect(wizard.getState().labels).toMatchObject({ typed: 'web', busy: null, error: { action: 'custom', message: "Couldn't create web in maddec01/lar-web: HTTP 403", name: 'web' } });
  expect(wizard.getState().run!.customLabels).toEqual([]);
  wizard.getState().typeCustomLabel('web2');
  expect(wizard.getState().labels!.error).toBeNull();
});

test('label creation streams progress and updates rows before the batch finishes', async () => {
  const wizard = await labelsStore([project('lar-web')], []);
  await toLabels(wizard, 'lar-web');
  const served = fetchMock.getMockImplementation()!;
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  fetchMock.mockImplementation(async (url: string) => url === '/api/onboarding/labels/create'
    ? new Response(new ReadableStream<Uint8Array>({ start(controller) { stream = controller; } }), { headers: { 'Content-Type': 'application/x-ndjson' } }) : served(url));
  let creating!: Promise<void>;
  await settle(() => { creating = wizard.getState().createLabels(); });
  await settle(() => stream.enqueue(new TextEncoder().encode('{"progress":{"labels":["bug"]}}\n')));
  expect(wizard.getState().labels!.read).toEqual({ state: 'loaded', names: ['bug'] });
  expect(wizard.getState().labels!.progress).toMatchObject({ created: 1 });
  expect(wizard.getState().labels!.busy).toBe('create');
  await settle(() => { stream.enqueue(new TextEncoder().encode(JSON.stringify({ result: { labels: EVERY_LABEL, error: null } }) + '\n')); stream.close(); });
  await creating;
  expect(wizard.getState().labels!.busy).toBeNull();
  expect(wizard.getState().labels!.read).toEqual({ state: 'loaded', names: EVERY_LABEL });
});

test('changing the Azure team discards counts from the previous team', async () => {
  const wizard = await checkingStore([AZURE], { source: { passed: true, detail: 'Found 23 items.', counts: { all: 23, 'opted-in': 0 } } }, toolChecks({ az: { result: 'ok' } }));
  await settle(() => wizard.getState().start());
  wizard.getState().pick(AZURE.id);
  wizard.getState().next();
  wizard.getState().answer({ team: 'App', role: 'API' });
  await settle(() => wizard.getState().runChecks());
  expect(wizard.getState().checks!.setup.source.state).toBe('done');
  wizard.getState().answer({ team: 'Controls' });
  expect(wizard.getState().checks).toBeNull();
});
