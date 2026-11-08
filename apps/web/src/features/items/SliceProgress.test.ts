import type { Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { shownSliceProgress } from './SliceProgress';

const item = { blockers: [{ state: 'open', number: 202 }], slices: [] } as unknown as Item;

test('an open blocker marks an active slice blocked, while preserving completed and unknown progress', () => {
    expect(
        ['active', 'done', 'unknown', 'blocked', 'waiting'].map((state) =>
            shownSliceProgress(item, state as Item['slices'][number]['progress']),
        ),
    ).toEqual(['blocked', 'done', 'unknown', 'blocked', 'waiting']);
});

test('a closed blocker leaves recorded slice progress unchanged', () => {
    expect(shownSliceProgress({ ...item, blockers: [{ ...item.blockers[0]!, state: 'closed' }] }, 'active')).toBe(
        'active',
    );
});
