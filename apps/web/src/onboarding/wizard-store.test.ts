import { expect, test } from 'vite-plus/test';
import { fetchMock, sample, settle } from '../../test/support.ts';
import { detection, posted, project, serve } from './onboarding-support.ts';
import type { SetupDetection } from '@lar-factory/shared';

async function start(found: SetupDetection = detection()) {
  serve(sample, [project('lar-web')], { error: null }, 200, {
    '/api/onboarding/detect': { detection: found, error: null }, '/api/onboarding/setup': { error: null },
  });
  const { useWizardStore, stepReady } = await import('./wizard-store.ts');
  await settle(() => useWizardStore.getState().start());
  useWizardStore.getState().pick('lar-web');
  await settle(() => useWizardStore.getState().next());
  return { wizard: useWizardStore, ready: () => { const { run, projects, detection: read } = useWizardStore.getState(); return stepReady(run!, projects, read); } };
}

test('onboarding chooses a source without importing individual tickets or changing repository files', async () => {
  const { wizard, ready } = await start();
  expect(wizard.getState().run?.step).toBe('work');
  expect(ready()).toBe(true);
  await settle(() => wizard.getState().next());
  expect(wizard.getState().run?.step).toBe('access');
  await settle(() => wizard.getState().save());
  expect(wizard.getState().finish.state).toBe('done');
  expect(posted('/api/onboarding/setup')[0]).toMatchObject({ repo: 'maddec01/lar-web', projectId: 'lar-web', role: '', itemSource: { kind: 'issues' }, structureSync: true, domainDocs: { kind: 'off' } });
  const routes = fetchMock.mock.calls.map(([url]) => url);
  expect(routes.some((url) => /onboarding\/(?:import|pr(?:\/|$))|config/.test(url))).toBe(false);
});

test('enabled concept sync requires positive write access; local-only shaping remains available', async () => {
  const found = detection();
  found.access['comment-ticket'] = 'unverified';
  const { wizard, ready } = await start(found);
  await settle(() => wizard.getState().next());
  expect(ready()).toBe(false);
  await settle(() => wizard.getState().save());
  expect(posted('/api/onboarding/setup')).toEqual([]);
  wizard.getState().choose({ structureSync: false });
  expect(ready()).toBe(true);
  await settle(() => wizard.getState().save());
  expect(posted('/api/onboarding/setup')[0]?.structureSync).toBe(false);
});

test('an Azure source needs a readable team, not individual item picks', async () => {
  const { wizard, ready } = await start(detection({ provider: 'Azure DevOps', itemSources: { found: [] } }));
  expect(ready()).toBe(false);
  wizard.getState().choose({ itemSource: { kind: 'azure-board', team: 'Example App' }, structureSync: false });
  expect(ready()).toBe(true);
});

test('a refused checkout cannot finish even with sync off', async () => {
  const { wizard, ready } = await start(detection({ checkout: { refused: 'Use the main checkout.' } }));
  wizard.getState().choose({ structureSync: false });
  expect(ready()).toBe(false);
});

test('closing preserves choices for an explicit resume', async () => {
  const { wizard } = await start();
  wizard.getState().choose({ structureSync: false, role: 'API server' });
  await settle(() => wizard.getState().close());
  expect(posted('/api/onboarding/repositories')[0]).toMatchObject({ repo: 'maddec01/lar-web', progress: { step: 'work', answers: { choices: { structureSync: false, role: 'API server' } } } });
  expect(wizard.getState().run).toBeNull();
});

test('a project changed while detection runs cannot receive its stale response', async () => {
  const { wizard } = await start();
  let answer!: (response: Response) => void;
  fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { answer = resolve; }));
  const pending = wizard.getState().detect();
  wizard.getState().chooseNew();
  await settle(() => answer(new Response(JSON.stringify({ detection: detection() }))));
  await pending;
  expect(wizard.getState().detection).toBeNull();
});
