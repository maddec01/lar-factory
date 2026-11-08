// Operational warnings are inline details. They never open a toast or dialog.
import type { ReactNode } from 'react';

import { useDismissed, useDismissStore } from './DismissStore';
import { closeKeepingFocus } from './ToastActions';
import { BoardWarning } from '@/ui/board';

export function Warning({
    dismissKey,
    title,
    what = title,
    action,
    tone,
    children,
}: {
    dismissKey: string;
    what?: string;
    title: string;
    action?: ReactNode;
    tone?: 'warning' | 'danger';
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
            tone={tone}
        >
            {children}
        </BoardWarning>
    );
}
