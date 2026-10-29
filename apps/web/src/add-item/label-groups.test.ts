// Label groups: a repository's custom labels grouped by the text before ": ".

import { expect, test } from 'vite-plus/test';
import { labelGroups } from './label-groups.ts';

test('labels group by the text before ": ", each option showing the rest, and unprefixed labels come last under Other', () => {
  expect(labelGroups(['UI', 'app: music', 'os: ios', 'app: video'])).toEqual([
    { heading: 'app', options: [{ label: 'app: music', text: 'music' }, { label: 'app: video', text: 'video' }] },
    { heading: 'os', options: [{ label: 'os: ios', text: 'ios' }] },
    { heading: 'Other', options: [{ label: 'UI', text: 'UI' }] },
  ]);
});

test('only the first ": " splits, and a colon without a space is no prefix', () => {
  expect(labelGroups(['area: web: beta', 'a:b'])).toEqual([
    { heading: 'area', options: [{ label: 'area: web: beta', text: 'web: beta' }] },
    { heading: 'Other', options: [{ label: 'a:b', text: 'a:b' }] },
  ]);
});

test('no labels make no groups', () => {
  expect(labelGroups([])).toEqual([]);
});
