import { expect, test } from 'vite-plus/test';

import { verificationPassed, verificationProblem, verificationTestSteps, type Verification } from './verification.ts';

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
            by: 'Pedro',
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
test('Test steps preserves nested Markdown and stops at the next peer heading', () => {
    expect(
        verificationTestSteps(
            '## Summary\nChange\n## Test steps\n1. Test.\n### Mobile\n2. Narrow.\n## Checks\nSecret extra',
        ),
    ).toBe('1. Test.\n### Mobile\n2. Narrow.');
    expect(verificationTestSteps('# TEST STEPS\r\nDo it.')).toBe('Do it.');
    expect(verificationTestSteps('## Tests\nDo it.')).toBe('');
});

test.each(['Test steps', 'Test', 'Testing', 'Verify steps', 'Manual checks'])(
    'S05-F4-002 reads numbered manual checks under %s',
    (heading) => {
        expect(
            verificationTestSteps(
                `## ${heading}\n1. Open sim-891.html; Hello, Pedro! is visible.\n## Checks\n11 passed.`,
            ),
        ).toBe('1. Open sim-891.html; Hello, Pedro! is visible.');
    },
);

test('a fenced Test example cannot stand in for actual PR manual checks', () => {
    expect(verificationTestSteps('```md\n## Test\n1. Fake\n```')).toBe('');
});
