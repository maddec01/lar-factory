// The onboarding run: its steps, the T3 projects it offers, picking one, and moving between the steps.

import { expect, test } from 'vite-plus/test';
import { fetchMock, settle } from '../../test/support.ts';
import type { ProjectChoice } from '@lar-factory/shared';

const project = (name: string, parts: Partial<ProjectChoice> = {}): ProjectChoice => ({
  id: name, name, folder: `/Users/me/Developer/${name}`, repo: `maddec01/${name}`, provider: 'GitHub', hasConfig: false, onBoard: false, ...parts,
});
const PROJECTS = [project('lar-web'), project('lar-server', { onBoard: true }), project('notes', { repo: null, provider: null, hasConfig: null })];

/** The store, fresh, with T3's projects answered by `reply`. */
async function store(reply: () => Response = () => new Response(JSON.stringify({ projects: PROJECTS }))) {
  fetchMock.mockImplementation(async () => reply());
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
  expect(wizard.getState().run).toEqual({ step: 'project', done: [], projectId: null });
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
  expect(wizard.getState().run).toEqual({ step: 'setup', done: ['project'], projectId: 'lar-web' });
  expect(ready(), 'a later step waits for its slice').toBe(false);
  wizard.getState().back();
  expect(wizard.getState().run!.step).toBe('project');
});

test('closing drops the run', async () => {
  const wizard = await store();
  await settle(() => wizard.getState().start());
  wizard.getState().pick('lar-web');
  wizard.getState().close();
  expect(wizard.getState().run).toBeNull();
  await settle(() => wizard.getState().start());
  expect(wizard.getState().run!.projectId).toBeNull();
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
