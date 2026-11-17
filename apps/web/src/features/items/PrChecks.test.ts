import type { BoardData, Item, LinkedPr } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { prChecks } from './PrChecks';

const checks = { passed: 3, failed: 1, running: 0, total: 4, since: null };
const pr = (more: Partial<LinkedPr> = {}) =>
    ({
        number: 7,
        url: 'https://dev.azure.com/o/p/_git/r/pullrequest/7',
        state: 'open',
        isDraft: false,
        checks,
        checkProgress: { state: 'current' },
        ...more,
    }) as LinkedPr;
const item = (more: Partial<LinkedPr> = {}) =>
    ({ repo: 'o/p/r', status: 'In progress', linkedPrs: [pr(more)] }) as unknown as Item;
const board = (more: Partial<BoardData> = {}) => more as BoardData;

test('an In progress item with an open PR shows its checks', () => {
    expect(prChecks(item(), board(), false)).toEqual({ checks, stale: false });
});

test('checks the board cannot vouch for keep their last known counts, marked stale', () => {
    expect(prChecks(item({ checkProgress: { state: 'stale' } }), board(), false)).toEqual({ checks, stale: true });
    expect(prChecks(item(), board(), true)).toEqual({ checks, stale: true });
    expect(
        prChecks(item(), board({ itemSourceProblems: [{ repo: 'o/p/r', reason: 'az logged out' }] as never }), false),
    ).toEqual({ checks, stale: true });
});

test('a PR with no checks to show, or not open, shows none', () => {
    expect(prChecks(item({ checkProgress: { state: 'unavailable' } }), board(), false)).toBeNull();
    expect(prChecks(item({ pipelineUnread: true }), board(), false)).toBeNull();
    expect(prChecks(item({ checks: null }), board(), false)).toBeNull();
    expect(prChecks(item({ state: 'merged' }), board(), false)).toBeNull();
});
