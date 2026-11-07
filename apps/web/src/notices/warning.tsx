// Operational warnings are inline details. They never open a toast or dialog.
import type { ReactNode } from 'react';

import { useDismissed, useDismissStore } from './dismiss-store.ts';
import { DismissButton, closeKeepingFocus } from './toasts.tsx';

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
        <div data-slot="notice" className="relative border-t py-3 pr-8 text-xs first:border-t-0 first:py-1">
            <div data-warning={dismissKey}>
                <DismissButton
                    what={`: ${what}`}
                    onClick={(event) =>
                        closeKeepingFocus(event.currentTarget.closest('[data-slot="notice"]'), () =>
                            useDismissStore.getState().dismiss(dismissKey),
                        )
                    }
                />
                <div data-slot="title" className="font-medium">
                    {title}
                </div>
                <div data-slot="description" className="text-base-700 mt-1">
                    {children}
                </div>
                {action && <div className="mt-2">{action}</div>}
            </div>
        </div>
    );
}
