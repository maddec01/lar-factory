// The setup fields' answers: the suggested show setting following the item source until one is picked, and what Next
// or Save waits for.

import { expect, test } from 'vite-plus/test';
import type { SetupAnswers } from '@lar-factory/shared';
import { answerSetup, setupItemSource, setupProblems } from './setup-answers.ts';

const SETUP: SetupAnswers = { itemSource: 'issues', show: 'all', showPicked: false, role: 'Web client' };

test('a new item source takes its suggested show setting until one is picked, then the pick stays', () => {
  expect(answerSetup(SETUP, { itemSource: 'issues' })).toEqual({ ...SETUP, itemSource: 'issues', show: 'all' });
  const picked = answerSetup(SETUP, { show: 'opted-in' });
  expect(picked.showPicked).toBe(true);
  expect(answerSetup(picked, { itemSource: 'issues' }).show).toBe('opted-in');
});


test('Save validates the role and Azure team', () => {
  expect(setupProblems({ ...SETUP, itemSource: 'azure-board', team: '', role: '' }, 'Save')).toEqual({
    team: 'Choose a team to continue with Save.', role: 'Describe what this repository does to continue with Save.',
  });
  expect(setupItemSource(SETUP)).toEqual({ kind: 'issues' });
  expect(setupItemSource({ ...SETUP, itemSource: 'azure-board', team: ' Team ' })).toEqual({ kind: 'azure-board', team: 'Team' });
});

test('All items is suggested for new repositories', async () => {
  const { suggestedShow } = await import('./setup-answers.ts');
  expect(suggestedShow()).toBe('all');
});
