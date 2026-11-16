import { expect, test } from 'vite-plus/test';

import { prReadiness, type Item, type LinkedPr } from './model.ts';

const pr: LinkedPr = {
    number: 1,
    url: 'https://example.com/pr/1',
    state: 'open',
    isDraft: false,
    mergeState: 'can merge',
    checks: null,
};
const item = (patch: Partial<LinkedPr> = {}): Pick<Item, 'status' | 'linkedPrs'> => ({
    status: 'Ready to merge',
    linkedPrs: [{ ...pr, ...patch }],
});

test('failed checks override the recorded stage', () => {
    expect(prReadiness(item({ checks: { failed: 1, passed: 2, running: 1, total: 4, since: null } }))).toMatchObject({
        word: 'Checks failed',
        action: 'Review failed checks',
    });
});
test('withdraws readiness for stale check evidence', () => {
    expect(
        prReadiness(
            item({
                checkProgress: { state: 'stale' },
                checks: { passed: 3, failed: 0, running: 0, total: 3, since: null },
            }),
        ),
    ).toMatchObject({ word: 'Review PR', action: 'Review PR', state: 'waiting' });
});
test('unknown native check states cannot claim passing checks', () => {
    expect(prReadiness(item({ checks: { passed: 1, failed: 0, running: 0, total: 2, since: null } }))).toMatchObject({
        word: 'Checks unknown',
        state: 'off',
    });
});
