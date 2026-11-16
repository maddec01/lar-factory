// Whether the reader is moving around the board by keyboard, for styles that show what focus alone should show.

// Keys that move focus. Escape and Enter are not among them: closing a dialog with Escape gives focus back to the row
// that opened it, and the browser then counts that focus as keyboard focus though the reader never moved by keyboard.
const MOVES = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);

/** Marks the page `data-keys` while the reader moves focus by keyboard, until the pointer is used again. */
export function trackKeyboardNavigation() {
    const page = document.documentElement;

    document.addEventListener(
        'keydown',
        (event) => {
            if (MOVES.has(event.key)) page.dataset.keys = '';
        },
        true,
    );
    document.addEventListener('pointerdown', () => delete page.dataset.keys, true);
}
