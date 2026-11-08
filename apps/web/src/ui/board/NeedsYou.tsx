// Why a piece of work waits on the user, in the item dialog: the reason and the choices the board offers for it.

import { Alert } from '@lar-works/design-system';
import { Children, type ReactNode } from 'react';

/** The reason a piece of work needs you, in the warning tone, then the `actions` that answer it, if any, and any
 *  `result`. Abandon among the actions is the quiet-destructive Button (`variant="destructive-quiet"`), and asks in its
 *  confirmation first. */
export function NeedsYouNotice({
    reason,
    actions,
    children,
}: {
    /** Why the work needs you. */
    reason: ReactNode;
    /** The buttons that answer it; none for a reason only the reader can answer elsewhere, such as in T3. */
    actions?: ReactNode;
    /** What the last choice left to say, under the actions. */
    children?: ReactNode;
}) {
    return (
        <div className="grid gap-2" data-needs-you-reason>
            <Alert
                size="sm"
                tone="warning"
                message={reason}
                action={
                    Children.toArray(actions).length ? (
                        <span className="flex flex-wrap gap-1.5">{actions}</span>
                    ) : undefined
                }
            />
            {children}
        </div>
    );
}

/** What a choice's cleanup left to say, announced. */
export function NeedsYouResult({
    children,
}: {
    /** What the cleanup left to say. */
    children: ReactNode;
}) {
    return <Alert size="sm" tone="danger" message={children} />;
}
