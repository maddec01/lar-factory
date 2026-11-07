// Operational warnings are inline details. They never open a toast or dialog.
import { BoardWarning } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { useDismissed, useDismissStore } from './DismissStore';
import { closeKeepingFocus } from './Toasts';

export function Warning({
    dismissKey,
    title,
    what = title,
    action,
    children,
}: {
    dismissKey: string;
    what?: string;
    title: string;
    action?: ReactNode;
    children: ReactNode;
}) {
    const dismissed = useDismissed(dismissKey);

    if (dismissed) return null;

    return (
        <BoardWarning
            name={dismissKey}
            title={title}
            dismissLabel={`Dismiss: ${what}`}
            onDismiss={(event) =>
                closeKeepingFocus(event.currentTarget.closest('[data-slot="notice"]'), () =>
                    useDismissStore.getState().dismiss(dismissKey),
                )
            }
            action={action}
        >
            {children}
        </BoardWarning>
    );
}
