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

test.each([
    [{ checks: { failed: 1, passed: 2, running: 1, total: 4, since: null } }, 'Checks failed', 'Review failed checks'],
    [{ checks: { failed: 0, passed: 2, running: 1, total: 3, since: null } }, 'Checks running', 'Review PR'],
    [{ mergeState: 'conflicts' }, 'Resolve conflicts', 'Review PR'],
    [{ mergeState: 'checking' }, 'Checking mergeability', 'Review PR'],
    [{ isDraft: true }, 'Review PR', 'Review PR'],
    [{ state: 'closed' }, 'Review PR', 'Review PR'],
    [{ pipelineUnread: true }, 'Review PR', 'Review PR'],
] as const)('current evidence overrides the recorded stage: %j', (patch, word, action) => {
    expect(prReadiness(item(patch))).toMatchObject({ word, action });
});
test('clean current evidence keeps the recorded merge stage and a missing PR cannot promise a merge', () => {
    expect(prReadiness(item())).toBeNull();
    expect(prReadiness({ status: 'Ready to merge', linkedPrs: [] })?.action).toBe('Review PR');
    expect(prReadiness({ ...item(), status: 'Done' })).toBeNull();
});
