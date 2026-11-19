import { expect, test } from 'vite-plus/test';

import type { Item } from './item-domain.ts';
import { dueUserReleaseStep, isHumanRole, pendingUserReleaseStep, type ReleasePlan } from './release-plan.ts';

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

test('a user release step waits until no part is still being built', () => {
    const parent = { id: 'group', releasePlan: plan('User') } as unknown as Item;
    const part = (status: string, complete = false) =>
        ({ id: 'part', parentId: 'group', status, completion: { complete, reasons: [] } }) as unknown as Item;

    expect(dueUserReleaseStep(parent, [parent, part('In progress')])).toBeUndefined();
    expect(dueUserReleaseStep(parent, [parent, part('Ready')])).toBeUndefined();
    expect(dueUserReleaseStep(parent, [parent, { ...part('Ready'), setAside: true } as Item])?.id).toBe('activate');
    expect(dueUserReleaseStep(parent, [parent, part('Verify', true)])?.id).toBe('activate');
    expect(dueUserReleaseStep(parent, [parent, part('Done')])?.id).toBe('activate');
});
