// Why a piece of work waits on the user, in the item dialog: the reason and the choices the board offers for it.

import { Alert, StatusIndicator } from '@lar-works/design-system';
import { Children, type ReactNode } from 'react';

/** The reason a piece of work needs you, on the desk card's attention bar (the design system's attention recipe: an
 *  amber edge, a 3px amber bar down its leading edge and a faint wash), then the `actions` that answer it, if any, and
 *  any `result`. Abandon among the actions is the quiet-destructive Button (`variant="destructive-quiet"`), and asks
 *  in its confirmation first. */
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
            <div className="attention attention-warning flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg py-2 pr-2 pl-4">
                <p className="m-0 flex min-w-0 flex-1 basis-64 items-start gap-2 text-sm">
                    <span className="flex h-5 shrink-0 items-center">
                        <StatusIndicator state="waiting" srLabel="Needs you:" />
                    </span>
                    <span className="min-w-0 wrap-anywhere">{reason}</span>
                </p>
                {Children.toArray(actions).length ? (
                    <span className="ml-auto flex flex-wrap gap-1.5">{actions}</span>
                ) : null}
            </div>
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
