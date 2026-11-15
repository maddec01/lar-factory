// An expanded concept's parts box, the button that folds its done parts away, and a part's kind as its icon.

import {
    BookOpenIcon,
    HammerIcon,
    ListChecksIcon,
    MessagesSquareIcon,
    ShapesIcon,
} from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { FoldToggle } from './FoldToggle';

const KIND_ICON = {
    grill: MessagesSquareIcon,
    prototype: ShapesIcon,
    research: BookOpenIcon,
    task: ListChecksIcon,
    decision: MessagesSquareIcon,
    build: HammerIcon,
} as const;

/** What a dossier's part is: a decision's method, or a build. */
export type PartKind = keyof typeof KIND_ICON;

/** A part's method or kind as its icon alone, such as a row's kind mark draws. */
export function PartKindIcon({ kind }: { kind: PartKind }) {
    const Icon = KIND_ICON[kind];

    return <Icon aria-hidden="true" />;
}

/** An expanded concept's parts list on the board, in the same box as its Work map, so the two views share one frame
 *  and switching between them doesn't move the concept's body; its parts are lane rows (StageRowItem), from the box's
 *  edge as a lane's rows run from its pane's, then the fold of the done ones. */
export function PartsFrame({ children }: { children: ReactNode }) {
    return (
        <div className="border-line bg-surface-page grid gap-1 rounded-lg border" data-parts-frame data-parts-list>
            {children}
        </div>
    );
}

/** The button under the parts that shows or hides the done ones. */
export function ShowDoneToggle({
    open,
    onToggle,
    children,
}: {
    /** The done parts are shown. */
    open: boolean;
    /** Called as the reader shows or hides the done parts. */
    onToggle: () => void;
    /** The button's text, such as "Show 3 done". */
    children: string;
}) {
    // Its words on the parts' 12px inner edge, a line under the last part.
    return (
        <span className="mb-1.5 ml-3 justify-self-start">
            <FoldToggle open={open} onToggle={onToggle}>
                {children}
            </FoldToggle>
        </span>
    );
}
