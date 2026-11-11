import { AppShell, Loading } from '@lar-works/design-system';
import type { ReactNode } from 'react';

/**
 * Lar Factory's window: the design system's desktop AppShell (`scroll="contained"`). The window holds the title bar
 * and the board's main area in one scroller, so the board passes under the bar's glass, which shows its hairline once
 * scrolled; in the Mac app the bar drags the window and starts past the traffic lights. Beside the scroller, outside
 * `main`, sits what goes over the board (its dialogs, live regions and notifications), so their announcements sit
 * apart from the page. `main` opens with the page's heading for screen readers, which a closing dialog whose opener
 * went away can focus.
 */
export function BoardShell({
    header,
    heading,
    trafficLights,
    children,
    overlays,
}: {
    /** The board's title bar, a BoardTitleBar. */
    header: ReactNode;
    /** The page's heading, for screen readers only, as the lockup is a link; none where the content has its own. */
    heading?: string;
    /** In the Mac app with its traffic lights showing: the bar starts past them. */
    trafficLights: boolean;
    /** The board's content, under the title bar. */
    children: ReactNode;
    /** What sits over the board, outside `main`: its dialogs, live regions and notifications. */
    overlays?: ReactNode;
}) {
    return (
        <AppShell scroll="contained" header={header} overlays={overlays} trafficLights={trafficLights}>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                {heading ? (
                    <h1 className="sr-only" tabIndex={-1}>
                        {heading}
                    </h1>
                ) : null}
                {children}
            </main>
        </AppShell>
    );
}

/** Everything under the title bar, which scrolls with the main area as one page, on the bar's 16px gutter; nothing in
 *  it shrinks to fit. */
export function BoardContent({
    children,
}: {
    /** Everything under the title bar. */
    children: ReactNode;
}) {
    return <div className="px-gutter-app flex flex-1 flex-col gap-3 pt-3 pb-4 *:shrink-0">{children}</div>;
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
