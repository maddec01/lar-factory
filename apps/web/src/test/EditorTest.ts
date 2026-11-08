// Drives the description editor the way typing does. jsdom fires no beforeinput, so the text goes in through the
// editor itself, one character per update, as keystrokes would, and the Markdown shortcuts see each one.

import { $getRoot, $getSelection, $isRangeSelection, INSERT_PARAGRAPH_COMMAND } from 'lexical';
import type { LexicalEditor } from 'lexical';
import { act } from 'react';

// jsdom lays nothing out, and Lexical measures the selection to scroll it into view.
if (!('getBoundingClientRect' in (Range.prototype as object)))
    Range.prototype.getBoundingClientRect = () => new DOMRect();

if (!('getClientRects' in (Range.prototype as object)))
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;

// jsdom reports a DOM selection that markup changes have collapsed, and Lexical would take it as the user's. The tests
// set the selection through the editor alone.
document.addEventListener('selectionchange', (event) => event.stopImmediatePropagation(), true);

/** The Lexical editor behind a description editor's text area. */
const editorOf = (el: Element): LexicalEditor => (el as Element & { __lexicalEditor: LexicalEditor }).__lexicalEditor;

/** Types `text` at the selection, or at the end when there is none; "\n" presses Enter. */
export async function typeInto(el: Element, text: string): Promise<void> {
    const editor = editorOf(el);

    for (const char of text) {
        await act(async () => {
            if (char === '\n') editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
            else
                editor.update(
                    () => {
                        let selection = $getSelection();

                        if (!$isRangeSelection(selection)) selection = $getRoot().selectEnd();

                        selection.insertText(char);
                    },
                    { discrete: true },
                );
        });
    }
}

/** Puts the caret after the editor's last character, as a click past its text does. */
export const selectEnd = (el: HTMLElement) =>
    act(async () =>
        editorOf(el).update(
            () => {
                $getRoot().selectEnd();
            },
            { discrete: true },
        ),
    );
