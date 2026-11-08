import { Loading } from '@lar-works/design-system';
import { useScrolled } from '@lar-works/design-system/primitives';
import { type ReactNode, useRef } from 'react';

/** Lar Factory's window: the board's main area filling the window, and beside it, outside `main`, what sits over the
 *  board (its dialogs, live regions and notifications), so their announcements sit apart from the page. The main area
 *  is what scrolls, so the board passes under the title bar's glass, which shows its hairline once scrolled. */
export function BoardShell({
    children,
    overlays,
}: {
    /** The board's title bar and content. */
    children: ReactNode;
    /** What sits over the board, outside `main`: its dialogs, live regions and notifications. */
    overlays?: ReactNode;
}) {
    const main = useRef<HTMLElement>(null);
    const scrolled = useScrolled(main);

    return (
        <div className="bg-surface-page text-fg fixed inset-0 flex flex-col">
            <main
                ref={main}
                data-scrolled={scrolled || undefined}
                // The page itself, which scrolls under the title bar's glass: no fade.
                data-scroll-fade="exempt"
                className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            >
                {children}
            </main>
            {overlays}
        </div>
    );
}

/** Everything under the title bar, which scrolls with the main area as one page; nothing in it shrinks to fit. */
export function BoardContent({
    children,
}: {
    /** Everything under the title bar. */
    children: ReactNode;
}) {
    return <div className="px-gutter-board flex flex-1 flex-col gap-3 pt-3 pb-4 *:shrink-0">{children}</div>;
}

/** A line that stands in for content the board is still reading, centred in its area. */
export function ReadingLine({
    label,
}: {
    /** What the board is reading, such as "Reading the board…". */
    label: string;
}) {
    return (
        <p className="text-fg-muted m-0 flex items-center justify-center gap-2 p-6 text-sm" data-reading>
            <Loading label={label} presentation="line" />
        </p>
    );
}
