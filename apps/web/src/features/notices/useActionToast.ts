import { useNotificationControls } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

/** Give board actions ten extra seconds before the notification's five-second hover/focus clock starts. */
export function useActionToast(held = false): void {
    const { hold } = useNotificationControls();
    const [reading, setReading] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setReading(false), 10_000);

        return () => clearTimeout(timer);
    }, []);
    useEffect(() => hold(reading || held), [hold, reading, held]);
}
