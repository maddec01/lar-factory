// The warning for each onboarded repository whose .lar-factory.json the board couldn't read.

import { serve, project } from '../onboarding/onboarding-support.ts';
import { expect, test } from 'vite-plus/test';
import { $, $$, warningText, mountPage, push, sample, settle, text } from '../../test/support.ts';

const problems = [
  { repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' },
  { repo: 'maddec01/lar-server', problem: '.lar-factory.json field labels must be an array of strings.' },
];

test("each repository whose .lar-factory.json can't be read gets a warning naming it and why, which clears once it reads", async () => {
  await mountPage({ ...sample, repositoryConfigProblems: problems });
  const warnings = () => $$('[data-slot="toaster"] [data-toast-color="warning"]');
  expect(warnings().map(warningText)).toEqual([
    ['maddec01/lar-apple is off the board.', 'No .lar-factory.json on its default branch. '
      + 'Read how to add a repository. The board reads it again on each refresh.'],
    ['maddec01/lar-server is off the board.', '.lar-factory.json field labels must be an array of strings. '
      + 'Read how to add a repository. The board reads it again on each refresh.'],
  ]);
  expect(warnings()[0]!.querySelector('a')!.getAttribute('href')).toBe('https://github.com/maddec01/lar-factory/blob/main/apps/server/README.md#adding-a-repository');
  expect(warnings()[0]!.dataset.toastColor).toBe('warning');

  await push({ ...sample, repositoryConfigProblems: [] });
  expect(warnings()).toEqual([]);
});

test('an unusable settings file offers fresh onboarding directly from its warning', async () => {
  const offer = { projectId: 'broken', name: 'broken', repo: 'maddec01/broken', provider: 'GitHub' as const, configProblem: 'unsupported source' };
  const data = { ...sample, repositoryConfigProblems: [{ repo: offer.repo, problem: offer.configProblem }], onboardingOffers: [offer] };
  serve(data, [project('broken', { hasConfig: true, configProblem: offer.configProblem })]);
  await mountPage(data);
  const warning = $$('[data-slot="toaster"] [data-toast-color="warning"]').find((entry) => text(entry).includes('maddec01/broken'))!;
  expect(text(warning)).toContain("Its settings file can't be used. Run onboarding to replace it.");
  await settle(() => [...warning.querySelectorAll<HTMLButtonElement>('button')].find((button) => text(button) === 'Run onboarding')!.click());
  expect($('[data-onboarding-dialog]')).not.toBeNull();
  const { useWizardStore } = await import('../onboarding/wizard-store.ts');
  expect(useWizardStore.getState().run!.projectId).toBe('broken');
});


test('stale agent guidance shows its fix and clears after migration', async () => {
  await mountPage({ ...sample, repositoryConfigProblems: [{ repo: 'owner/api', kind: 'agent-guidance',
    problem: 'Update AGENTS.md to use lar-shape and lar-build, merge into the default branch, then refresh.' }] });
  const warning = $$('[data-slot="toaster"] [data-toast-color="warning"]').find((entry) => text(entry).includes('owner/api'))!;
  expect(text(warning)).toContain('owner/api needs attention to agent guidance.');
  expect(text(warning)).toContain('Update AGENTS.md to use lar-shape and lar-build');
  expect(text(warning)).not.toContain('off the board');
  await push({ ...sample, repositoryConfigProblems: [] });
  expect(text(document.body)).not.toContain('owner/api needs attention to agent guidance.');
});

test('a repository whose shared config is unusable says it keeps its last usable setup, and why', async () => {
  await mountPage({ ...sample, repositoryConfigProblems: [{ repo: 'owner/api', kind: 'shared-config', problem: ".lar-factory.json isn't valid JSON." }] });
  const warning = $$('[data-slot="toaster"] [data-toast-color="warning"]').find((entry) => text(entry).includes('owner/api'))!;
  expect(warningText(warning)).toEqual(['owner/api keeps its last usable setup.',
    ".lar-factory.json isn't valid JSON. The board reads it again on each refresh."]);
});
