// The board's one fold: a quiet line of words that shows or hides what follows it, with the chevron every fold shares.

import { ChevronRightIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The fold's chevron: pointing right while folded, turned down while open. Every fold on the board draws this one,
 *  the icon-only ones (a dossier's) as well. */
export function FoldChevron({ open }: { open: boolean }) {
    return (
        <ChevronRightIcon
            aria-hidden="true"
            className={`size-3.5 shrink-0 transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}
        />
    );
}

/** A toggle that shows or hides what follows it, such as "Show 3 done" or a row's slice count: muted 12px words that
 *  brighten over a fill on hover, the focus ring, then the chevron. Its words sit where plain text would, the fill
 *  reaching a little past them, so a fold lines up with the text around it. */
export function FoldToggle({
    open,
    onToggle,
    label,
    children,
    ...data
}: {
    /** What it folds is shown. */
    open: boolean;
    /** Called as the reader shows or hides it. */
    onToggle: () => void;
    /** Its accessible name, when its words alone don't say what it shows or hides. */
    label?: string | undefined;
    /** Its words, such as "Show 3 done". */
    children: ReactNode;
} & DataAttributes) {
    return (
        <button
            type="button"
            {...data}
            aria-expanded={open}
            aria-label={label}
            onClick={onToggle}
            className="text-fg-muted hover:bg-fill-hover hover:text-fg focus-ring -mx-1.5 -my-0.5 inline-flex min-w-0 items-center gap-1 justify-self-start rounded-xs px-1.5 py-0.5 text-left text-xs whitespace-nowrap tabular-nums transition-colors"
        >
            {children}
            <FoldChevron open={open} />
        </button>
    );
}
