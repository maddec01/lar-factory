import { expect, it } from 'vite-plus/test';

import { useActionStore } from './ActionStore';

it('retains cleanup errors independently of the recovery notice and action lifecycle', () => {
    const actions = useActionStore.getState();

    actions.setCleanupResult('work', 'Branch remains');
    actions.set('work', undefined);
    expect(useActionStore.getState().cleanupResults.work).toBe('Branch remains');
    actions.setCleanupResult('work', undefined);
    expect(useActionStore.getState().cleanupResults.work).toBeUndefined();
});
