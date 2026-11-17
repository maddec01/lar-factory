import { expect, test } from 'vite-plus/test';

import { type ReconcileItem, type ReconcileReport, unseenMerge } from './group-reconciliation.ts';

const finished = (workId: string): ReconcileItem => ({
    key: `map:${workId}`,
    digest: `d-${workId}`,
    kind: 'map',
    workId,
    summary: `${workId}: reconcile map and affected records (finishedAt).`,
    changes: ['finishedAt'],
    requiresFix: false,
    before: { finishedAt: null },
    after: { finishedAt: '2026-11-17T00:00:00Z' },
});
const report = (items: ReconcileItem[], pending: ReconcileItem[] = []): ReconcileReport => ({
    groupId: 'group',
    digest: 'r',
    items,
    completed: [],
    pending,
});
const merged = (ids: string[]) => (workId: string) => ids.includes(workId);

test('a finished part with a merged PR the checklist has not seen is an unseen merge', () => {
    expect(unseenMerge(report([finished('a')]), merged(['a']))).toBe(true);
});

test('a part finished without a merged PR, such as a decision, never sends the board back to read its group', () => {
    expect(unseenMerge(report([finished('decision')]), merged([]))).toBe(false);
});

test('a merge the saved checklist already holds is not unseen', () => {
    expect(unseenMerge(report([finished('a')], [finished('a')]), merged(['a']))).toBe(false);
});
