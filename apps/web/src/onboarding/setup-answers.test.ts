// The setup fields' answers: the suggested show setting following the item source until one is picked, and what Next
// or Save waits for.

import { expect, test } from 'vite-plus/test';
import type { SetupAnswers } from '@lar-factory/shared';
import { answerSetup, setupItemSource, setupProblems } from './setup-answers.ts';

const SETUP: SetupAnswers = { itemSource: 'github-project', projectOwner: 'maddec01', projectNumber: '3', show: 'all', showPicked: false, role: 'Web client' };

test('a new item source takes its suggested show setting until one is picked, then the pick stays', () => {
  expect(answerSetup(SETUP, { itemSource: 'issues' })).toEqual({ ...SETUP, itemSource: 'issues', show: 'opted-in' });
  const picked = answerSetup(SETUP, { show: 'opted-in' });
  expect(picked.showPicked).toBe(true);
  expect(answerSetup(picked, { itemSource: 'github-project' }).show).toBe('opted-in');
});

test("Save's problems name Save, and whole answers have none", () => {
  expect(setupProblems(SETUP, 'Save')).toEqual({});
  expect(setupProblems({ ...SETUP, projectOwner: '-x', projectNumber: '0', role: ' ' }, 'Save')).toEqual({
    projectOwner: 'Enter a GitHub username or organization name to continue with Save.',
    projectNumber: 'Enter a project number greater than zero to continue with Save.',
    role: 'Describe what this repository does to continue with Save.',
  });
  expect(setupProblems({ ...SETUP, role: '' }).role).toBe('Describe what this repository does to continue with Next.');
});

test('the answers name a GitHub Project by its owner and number, or the issues', () => {
  expect(setupItemSource(SETUP)).toEqual({ kind: 'github-project', owner: 'maddec01', number: 3 });
  expect(setupItemSource({ ...SETUP, itemSource: 'issues' })).toEqual({ kind: 'issues' });
});
