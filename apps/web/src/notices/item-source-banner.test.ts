// The banner for each onboarded repository whose items the latest read left off, such as one reading through a logged-out az.

import { expect, test } from 'vite-plus/test';
import { $$, bannerText, mountPage, push, sample } from '../../test/support.ts';

const problems = [
  { repo: 'contoso/Fabrikam/lar-api', problem: 'az is logged out.', fix: 'az login' },
  { repo: 'contoso/Fabrikam/lar-web', problem: 'Team Web has no current iteration in contoso/Fabrikam. Give the team a sprint whose dates cover today in its project settings.' },
];

test("each repository whose items can't be read gets a banner naming it, why and its fix, which clears once it reads", async () => {
  await mountPage({ ...sample, itemSourceProblems: problems });
  const banners = () => $$('.banners .banner');
  expect(banners().map(bannerText)).toEqual([
    ["contoso/Fabrikam/lar-api's items are off the board.", 'az is logged out. Run az login Copy in a terminal. The board reads it again on each refresh.'],
    ["contoso/Fabrikam/lar-web's items are off the board.", 'Team Web has no current iteration in contoso/Fabrikam. Give the team a sprint whose dates cover today in its project settings. '
      + 'The board reads it again on each refresh.'],
  ]);
  expect(banners()[0]!.dataset.variant).toBe('warning');

  await push({ ...sample, itemSourceProblems: [] });
  expect(banners()).toEqual([]);
});
