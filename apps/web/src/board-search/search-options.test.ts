import { expect, test } from 'vite-plus/test';
import { matchingGroups } from './search-options.ts';

const option = (name: string) => ({ value: name, name, icon: null, select: () => undefined });
const groups = [
  { label: 'Repositories', options: [option('All repositories'), option('lar-server')] },
  { label: 'Kinds', options: [option('Bug')] },
];
const names = (query: string) => matchingGroups(groups, query).flatMap((group) => group.options.map(({ name }) => name));

test('an empty query lists everything', () => {
  expect(names('  ')).toEqual(['All repositories', 'lar-server', 'Bug']);
});

test('a result contains every word as a case-insensitive substring, in any order', () => {
  expect(names('REPOS all')).toEqual(['All repositories']);
  expect(names('all bug')).toEqual([]);
});

test('a group with no result goes, and the group name does not match', () => {
  expect(matchingGroups(groups, 'bug').map(({ label }) => label)).toEqual(['Kinds']);
  expect(names('kinds')).toEqual([]);
});
