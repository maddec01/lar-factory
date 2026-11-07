import { expect, test } from 'vite-plus/test';

import { matchingGroups } from './search-options.ts';

const option = (name: string) => ({ value: name, name, icon: null, select: () => undefined });
const groups = [
    { label: 'Projects', options: [option('All Projects'), option('lar-server')] },
    { label: 'Kinds', options: [option('Bug')] },
];
const names = (query: string) =>
    matchingGroups(groups, query).flatMap((group) => group.options.map(({ name }) => name));

test('an empty query lists everything', () => {
    expect(names('  ')).toEqual(['All Projects', 'lar-server', 'Bug']);
});

test('a result contains every word as a case-insensitive substring, in any order', () => {
    expect(names('PROJECTS all')).toEqual(['All Projects']);
    expect(names('all bug')).toEqual([]);
});

test('a group with no result goes, and the group name does not match', () => {
    expect(matchingGroups(groups, 'bug').map(({ label }) => label)).toEqual(['Kinds']);
    expect(names('kinds')).toEqual([]);
});

test('a hint counts as part of the result', () => {
    const hinted = [{ label: 'Settings', options: [{ ...option('Full refresh'), hint: 'General' }] }];

    expect(matchingGroups(hinted, 'general refresh')).toHaveLength(1);
});
