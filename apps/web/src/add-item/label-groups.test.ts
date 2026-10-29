// Label groups: a repository's custom labels grouped by the text before ": ".

import { expect, test } from 'vite-plus/test';
import { labelGroups } from './label-groups.ts';

test('labels group by the text before ": ", each option showing the rest, and unprefixed labels come last under Other', () => {
  expect(labelGroups(['UI', 'app: music', 'os: ios', 'app: video'])).toEqual([
    { heading: 'app', prefix: 'app', options: [{ label: 'app: music', text: 'music' }, { label: 'app: video', text: 'video' }] },
    { heading: 'os', prefix: 'os', options: [{ label: 'os: ios', text: 'ios' }] },
    { heading: 'Other', prefix: null, options: [{ label: 'UI', text: 'UI' }] },
  ]);
});

test('only the first ": " splits, and a colon without a space is no prefix', () => {
  expect(labelGroups(['area: web: beta', 'a:b'])).toEqual([
    { heading: 'area', prefix: 'area', options: [{ label: 'area: web: beta', text: 'web: beta' }] },
    { heading: 'Other', prefix: null, options: [{ label: 'a:b', text: 'a:b' }] },
  ]);
});

test('a prefix "Other" makes a group apart from the unprefixed labels, told apart by its prefix', () => {
  const groups = labelGroups(['Other: x', 'UI']);
  expect(groups.map(({ heading, prefix }) => [heading, prefix])).toEqual([['Other', 'Other'], ['Other', null]]);
});

test('no labels make no groups', () => {
  expect(labelGroups([])).toEqual([]);
});
