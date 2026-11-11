// Whether something has held long enough to say so, such as a load that says it's still trying after three seconds, as
// the design system's AsyncState does.

import { useEffect, useState } from 'react';

/** How long a load runs before it says it's still trying: the design system's AsyncState waits as long. */
const STILL_TRYING_MS = 3_000;

/** True once `active` has held for `ms`; false again as soon as it stops, so the next run waits its own `ms`. */
export function useHeldFor(active: boolean, ms = STILL_TRYING_MS): boolean {
    const [held, setHeld] = useState(false);

    useEffect(() => {
        if (!active) return;

        const timer = setTimeout(() => setHeld(true), ms);

        return () => {
            clearTimeout(timer);
            setHeld(false);
        };
    }, [active, ms]);

    return active && held;
}
