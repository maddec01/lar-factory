// The banner for each onboarded repository whose items the latest read left off, such as one reading through a logged-out az.

import { expect, test } from 'vite-plus/test';
import { $$, bannerText, mountPage, push, sample, toolChecks } from '../../test/support.ts';

const problems = [
  { repo: 'contoso/Fabrikam/lar-api', problem: 'az is logged out.', fix: 'az login' },
  { repo: 'contoso/Fabrikam/lar-web', problem: 'Team Web has no current iteration in contoso/Fabrikam. Give the team a sprint whose dates cover today in its project settings.' },
];

test("each repository whose items can't be read gets a banner naming it as the List modal does, why and its fix, which clears once it reads", async () => {
  await mountPage({ ...sample, itemSourceProblems: problems });
  const banners = () => $$('.banners .banner');
  expect(banners().map(bannerText)).toEqual([
    ["lar-api's items are off the board.", 'az is logged out. Run az login Copy in a terminal. The board reads it again on each refresh.'],
    ["lar-web's items are off the board.", 'Team Web has no current iteration in contoso/Fabrikam. Give the team a sprint whose dates cover today in its project settings. '
      + 'The board reads it again on each refresh.'],
  ]);
  expect(banners()[0]!.dataset.variant).toBe('warning');

  await push({ ...sample, itemSourceProblems: [] });
  expect(banners()).toEqual([]);
});

test("a repository whose problem the failed az check's fix covers shows no banner of its own beside the az banner", async () => {
  await mountPage({ ...sample, tools: toolChecks({ az: { result: 'logged-out', fix: 'az login' } }), itemSourceProblems: problems });
  expect($$('.banners .banner').map((b) => bannerText(b)[0])).toEqual(['Azure CLI is logged out.', "lar-web's items are off the board."]);
});
