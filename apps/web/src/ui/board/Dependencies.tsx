// The Dependencies holding a build, in the item dialog.

import { Alert } from '@lar-works/design-system';
import type { ReactNode } from 'react';

/** The Dependencies, one DependencyItem each. */
export function DependencyList({
    children,
}: {
    /** The Dependencies, one DependencyItem each. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid list-none gap-3 p-0 text-sm">{children}</ul>;
}

/** A Dependency: who owns it and whether it's met, its need, its latest read and evidence, what the board asks about it,
 *  and its `action`. */
export function DependencyItem({
    id,
    owner,
    need,
    read,
    evidence,
    notice,
    action,
}: {
    /** The Dependency's id, for its anchor. */
    id: string;
    /** Who owns it and whether it is met. */
    owner: ReactNode;
    /** What it needs. */
    need: ReactNode;
    /** The board's latest read of it. */
    read: ReactNode;
    /** What the read rests on. */
    evidence: ReactNode;
    /** What the board asks about it. */
    notice?: ReactNode;
    /** What you can do about it. */
    action: ReactNode;
}) {
    return (
        <li className="grid gap-1" data-dependency={id}>
            <span className="font-medium" data-dependency-owner>
                {owner}
            </span>
            <span>{need}</span>
            <span className="text-fg-muted text-xs" data-dependency-read>
                {read}
            </span>
            <span className="text-fg-muted text-xs" data-dependency-evidence>
                {evidence}
            </span>
            {notice && (
                <div data-dependency-notice>
                    <Alert size="sm" tone="warning" message={notice} />
                </div>
            )}
            <span>{action}</span>
        </li>
    );
}
