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
    projectOwner: 'Save needs a GitHub login: letters, digits and single hyphens, not at either end.',
    projectNumber: 'Save needs the number, a positive whole number like 3.',
    role: 'Save needs the repository’s role.',
  });
  expect(setupProblems({ ...SETUP, role: '' }).role).toBe('Next needs the repository’s role.');
});

test('the answers name a GitHub Project by its owner and number, or the issues', () => {
  expect(setupItemSource(SETUP)).toEqual({ kind: 'github-project', owner: 'maddec01', number: 3 });
  expect(setupItemSource({ ...SETUP, itemSource: 'issues' })).toEqual({ kind: 'issues' });
});
