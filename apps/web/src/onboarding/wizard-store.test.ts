// The onboarding run: its steps, the T3 projects it offers, picking one, moving between the steps, and keeping it
// on the board when the dialog closes, to resume.

import { expect, test } from 'vite-plus/test';
import { fetchMock, sample, settle } from '../../test/support.ts';
import type { BoardData, ProjectChoice } from '@lar-factory/shared';

const project = (name: string, parts: Partial<ProjectChoice> = {}): ProjectChoice => ({
  id: name, name, folder: `/Users/me/Developer/${name}`, repo: `maddec01/${name}`, provider: 'GitHub', hasConfig: false, onBoard: false, ...parts,
});
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
  expect(wizard.getState().run).toEqual({ step: 'project', done: [], projectId: null, repo: null, savedAs: null });
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/onboarding/projects']);
  expect(wizard.getState().projects).toEqual({ state: 'loaded', projects: PROJECTS });
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
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web', repo: 'maddec01/lar-web', savedAs: null });
  expect(ready(), 'a later step waits for its slice').toBe(false);
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
  expect(kept()).toEqual([{ repo: 'maddec01/lar-web', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-web' } } }]);
});

const onboardingBoard = (step: string): BoardData => ({ ...sample,
  onboarding: [{ repo: 'maddec01/lar-web', progress: { step, done: ['project'], answers: { projectId: 'lar-web' } } }] });

test('Resume reopens the run on its step with its answers, and its own project can be picked again', async () => {
  const wizard = await store(() => new Response(JSON.stringify({ projects: [project('lar-web', { onBoard: true }), project('lar-apple')] })));
  const { useBoardStore } = await import('../board/board-store.ts');
  useBoardStore.getState().receive(onboardingBoard('setup'));
  await settle(() => wizard.getState().resume('maddec01/lar-web'));
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web', repo: 'maddec01/lar-web', savedAs: 'maddec01/lar-web' });
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
    progress: { step: 'project', done: ['project'], answers: { projectId: 'lar-apple' } } }]);
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
