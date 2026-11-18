import { expect, test } from 'vite-plus/test';

import { verificationPassed, verificationProblem, type Verification } from './verification.ts';

test('only a pass on the current head permits required Verify', () => {
    const verification: Verification = {
        required: true,
        head: 'head',
        resume: null,
        latest: {
            id: 'result',
            pr: 'owner/repo#8',
            head: 'head',
            result: 'pass',
            by: 'User',
            at: 'now',
            note: null,
            testSteps: 'Test it.',
        },
    };

    expect(verificationPassed(verification, 'head')).toBe(true);
    expect(verificationProblem({ verification }, 'head')).toBeUndefined();
    expect(verificationProblem({ verification }, 'new')).toContain('current PR head');
    expect(verificationProblem({ verification }, undefined)).toBeTruthy();
    verification.latest!.result = 'fail';
    expect(verificationPassed(verification, 'head')).toBe(false);
});
