import { expect, test } from 'vite-plus/test';

import { nextAction } from './item-next-action.ts';
import type { Item } from './model.ts';
import { mergeStageProblem } from './pr-merge.ts';

const item = {
    id: 'build',
    kind: 'build',
    status: 'Ready to merge',
    threads: [],
    slices: [],
    linkedPrs: [
        {
            number: 8,
            url: 'https://github.com/o/r/pull/8',
            state: 'open',
            mergeState: 'can merge',
            checks: { passed: 2, failed: 0, running: 0, total: 2 },
        },
    ],
} as unknown as Item;

test('passing checks do not skip Verify or move the recorded stage', () => {
    const verify = { ...item, status: 'Verify' as const };

    expect(mergeStageProblem(verify)).toContain('verification');
    expect(nextAction(verify)?.label).toBe('Verify build');
    expect(verify.status).toBe('Verify');
    expect(nextAction(item)?.label).toBe('Merge PR');
});
