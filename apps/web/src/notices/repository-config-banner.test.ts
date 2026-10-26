// The banner for each onboarded repository whose .lar-factory.json the board couldn't read.

import { expect, test } from 'vite-plus/test';
import { $$, bannerText, mountPage, push, sample } from '../../test/support.ts';

const problems = [
  { repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' },
  { repo: 'maddec01/lar-server', problem: '.lar-factory.json field show must be "all" or "opted-in".' },
];

test("each repository whose .lar-factory.json can't be read gets a banner naming it and why, which clears once it reads", async () => {
  await mountPage({ ...sample, repositoryConfigProblems: problems });
  const banners = () => $$('.banners .banner');
  expect(banners().map(bannerText)).toEqual([
    ['maddec01/lar-apple is off the board.', 'No .lar-factory.json on its default branch. '
      + 'See Adding a repository in apps/server/README.md. The board reads it again on each refresh.'],
    ['maddec01/lar-server is off the board.', '.lar-factory.json field show must be "all" or "opted-in". '
      + 'See Adding a repository in apps/server/README.md. The board reads it again on each refresh.'],
  ]);
  expect(banners()[0]!.querySelector('a')!.getAttribute('href')).toBe('https://github.com/maddec01/lar-factory/blob/main/apps/server/README.md#adding-a-repository');
  expect(banners()[0]!.dataset.variant).toBe('warning');

  await push({ ...sample, repositoryConfigProblems: [] });
  expect(banners()).toEqual([]);
});
