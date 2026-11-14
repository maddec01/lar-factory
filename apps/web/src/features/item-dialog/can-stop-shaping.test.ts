import type { Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { canStopShaping } from './can-stop-shaping';

test('retired shaping records stay read-only even when their last owner was running', () => {
    const item = {
        status: 'Shaping',
        setAside: true,
        threads: [{ purpose: 'shape', state: 'running' }],
    } as Item;

    expect(canStopShaping(item)).toBe(false);
    expect(canStopShaping({ ...item, setAside: false })).toBe(true);
});
