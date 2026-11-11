/** The board's scroller: BoardShell's AppShell's contained main area. */
const SCROLLER = '[data-slot="app-shell-scroller"]';

/** Scrolls the board back to its top, as the lockup's home link does. */
export function scrollBoardToTop() {
    document.querySelector(SCROLLER)?.scrollTo({ top: 0 });
}
