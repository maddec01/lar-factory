import { expect, test } from 'vite-plus/test';

import fixture from '../test/s05-release-notice.json' with { type: 'json' };
import { legacyReleaseNoticeStep, receiptMatchesNotice } from './release-notice.ts';
import type { ReleasePlan } from './release-plan.ts';

const plan: ReleasePlan = {
    steps: [
        {
            id: 'approve-joint-activation',
            who: 'Pedro',
            what: 'Approve exact manifest',
            done: fixture.recordedApproval,
        },
    ],
    outcomeCheck: { what: 'Composition', result: 'pending', evidence: null },
};

test('S05 legacy notice identifies one explicit step; mentions and independent questions do not', () => {
    expect(legacyReleaseNoticeStep(plan, fixture.savedNotice)?.id).toBe('approve-joint-activation');
    for (const notice of [
        'No Pedro activation receipt is recorded.',
        fixture.savedNotice + ' Which region should we use?',
        'Please consider: ' + fixture.savedNotice,
        fixture.savedNotice.replace('approve-joint-activation', 'another-step'),
    ])
        expect(legacyReleaseNoticeStep(plan, notice)).toBeUndefined();
    expect(receiptMatchesNotice(fixture.recordedApproval.evidence, fixture.savedNotice)).toBe(true);
    expect(
        receiptMatchesNotice(
            fixture.recordedApproval.evidence,
            fixture.savedNotice.replace(/2387e9fe[\da-f]+/g, 'f'.repeat(64)),
        ),
    ).toBe(false);
});
