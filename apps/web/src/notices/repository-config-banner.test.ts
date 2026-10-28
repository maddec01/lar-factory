// The banner for each onboarded repository whose .lar-factory.json the board couldn't read.

import { serve, project } from '../onboarding/onboarding-support.ts';
import { expect, test } from 'vite-plus/test';
import { $, $$, bannerText, mountPage, push, sample, settle, text } from '../../test/support.ts';

const problems = [
  { repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' },
  { repo: 'maddec01/lar-server', problem: '.lar-factory.json field show must be "all" or "opted-in".' },
];

test("each repository whose .lar-factory.json can't be read gets a banner naming it and why, which clears once it reads", async () => {
  await mountPage({ ...sample, repositoryConfigProblems: problems });
  const banners = () => $$('.banners .banner');
  expect(banners().map(bannerText)).toEqual([
    ['maddec01/lar-apple is off the board.', 'No .lar-factory.json on its default branch. '
      + 'Read how to add a repository. The board reads it again on each refresh.'],
    ['maddec01/lar-server is off the board.', '.lar-factory.json field show must be "all" or "opted-in". '
      + 'Read how to add a repository. The board reads it again on each refresh.'],
  ]);
  expect(banners()[0]!.querySelector('a')!.getAttribute('href')).toBe('https://github.com/maddec01/lar-factory/blob/main/apps/server/README.md#adding-a-repository');
  expect(banners()[0]!.dataset.tone).toBe('warning');

  await push({ ...sample, repositoryConfigProblems: [] });
  expect(banners()).toEqual([]);
});

test('an unusable settings file offers fresh onboarding directly from its banner', async () => {
  const offer = { projectId: 'broken', name: 'broken', repo: 'maddec01/broken', provider: 'GitHub' as const, configProblem: 'unsupported source' };
  const data = { ...sample, repositoryConfigProblems: [{ repo: offer.repo, problem: offer.configProblem }], onboardingOffers: [offer] };
  serve(data, [project('broken', { hasConfig: true, configProblem: offer.configProblem })]);
  await mountPage(data);
  const banner = $$('.banners .banner').find((entry) => text(entry).includes('maddec01/broken'))!;
  expect(text(banner)).toContain("Its settings file can't be used. Run onboarding to replace it.");
  await settle(() => banner.querySelector<HTMLButtonElement>('button')!.click());
  expect($('[data-onboarding-dialog]')).not.toBeNull();
  const { useWizardStore } = await import('../onboarding/wizard-store.ts');
  expect(useWizardStore.getState().run!.projectId).toBe('broken');
});
