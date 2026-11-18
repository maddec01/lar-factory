import { expect, test } from 'vite-plus/test';

import { isHumanRole, pendingUserReleaseStep, type ReleasePlan } from './release-plan.ts';

const plan = (who: string): ReleasePlan => ({
    steps: [{ id: 'activate', who, what: 'Activate the approved manifest', done: null }],
    outcomeCheck: { what: 'Composition', result: 'pending', evidence: null },
});

test('a release step saved with the legacy human name still waits on the user', () => {
    expect(pendingUserReleaseStep(plan('Pedro'))?.id).toBe('activate');
    expect(isHumanRole('Pedro')).toBe(true);
});

test('only User, in any case, names the human role in new plans', () => {
    expect(pendingUserReleaseStep(plan('User'))?.id).toBe('activate');
    expect(pendingUserReleaseStep(plan(' user '))?.id).toBe('activate');
    expect(pendingUserReleaseStep(plan('Agent'))).toBeUndefined();
    expect(isHumanRole(undefined)).toBe(false);
});
