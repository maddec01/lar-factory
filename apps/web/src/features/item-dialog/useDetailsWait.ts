// How long an item's details have been loading, which the loading line and the placeholders that hold their place share,
// so both give way together when the read takes too long.

import { useEffect, useState } from 'react';

/** After this long a read is slow enough to say so. */
const SLOW_MS = 5000;
/** After this long a read stands for a failure: the line offers to try again or open the ticket instead. */
const GIVE_UP_MS = 12_000;

/** Where a read of `itemId`'s details stands while `loading`: '' at first, then `slow`, then `too long`, counted from
 *  when it began loading, however long the request itself stays pending. */
export function useDetailsWait(itemId: string, loading = true): '' | 'slow' | 'too long' {
    const [waited, setWaited] = useState<{ itemId: string; state: '' | 'slow' | 'too long' }>({ itemId, state: '' });

    useEffect(() => {
        if (!loading) return;

        const slow = setTimeout(() => setWaited({ itemId, state: 'slow' }), SLOW_MS);
        const tooLong = setTimeout(() => setWaited({ itemId, state: 'too long' }), GIVE_UP_MS);

        return () => {
            clearTimeout(slow);
            clearTimeout(tooLong);
        };
    }, [itemId, loading]);

    return loading && waited.itemId === itemId ? waited.state : '';
}
