// The board's quiet label chip: a tracker's label or tag as plain muted words with its dot, never a board state.

import type { ReactNode } from 'react';

/** A LabelChip drawn quiet, as the List's label column and an item's tracker tags show them: no fill, muted 400 words,
 *  its colour dot softened towards the text in light mode; `title` says where it comes from, such as "Azure DevOps tag:
 *  Blocked". (lar-web: a LabelChip `presentation="quiet"` would replace these descendant rules.) */
export function QuietLabel({
    title,
    children,
}: {
    /** Where the label comes from and its name, as its tooltip. */
    title?: string | undefined;
    /** The label's LabelChip. */
    children: ReactNode;
}) {
    return (
        <span
            title={title}
            data-quiet-label
            className="[&_[data-label-chip]]:text-fg-muted inline-flex max-w-full min-w-0 [&_[data-label-chip]]:bg-transparent [&_[data-label-chip]]:font-normal [&_[data-label-chip]_*]:pointer-events-none [&_[data-label-chip]_[style*='--status-dot']]:bg-[color-mix(in_oklab,var(--status-dot)_60%,var(--color-fg))] dark:[&_[data-label-chip]_[style*='--status-dot']]:bg-(--status-dot)"
        >
            {children}
        </span>
    );
}
