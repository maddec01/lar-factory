// Drives the description editor the way typing does. jsdom fires no beforeinput, so the text goes in through the
// editor itself, one character per update, as keystrokes would, and the Markdown shortcuts see each one.

import { act } from 'react';
import { $createRangeSelection, $getRoot, $getSelection, $isRangeSelection, $isTextNode, $setSelection, INSERT_PARAGRAPH_COMMAND } from 'lexical';
import type { LexicalEditor } from 'lexical';

// jsdom lays nothing out, and Lexical measures the selection to scroll it into view.
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
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
      else editor.update(() => {
        let selection = $getSelection();
        if (!$isRangeSelection(selection)) selection = $getRoot().selectEnd();
        selection.insertText(char);
      }, { discrete: true });
    });
  }
}

/** Selects all the editor's text, from its first character to its last, as a drag across it does. */
export const selectAll = (el: HTMLElement) => act(async () => editorOf(el).update(() => {
  const [first, last] = [$getRoot().getFirstDescendant(), $getRoot().getLastDescendant()];
  if (!$isTextNode(first) || !$isTextNode(last)) throw new Error('No text to select.');
  const selection = $createRangeSelection();
  selection.anchor.set(first.getKey(), 0, 'text');
  selection.focus.set(last.getKey(), last.getTextContentSize(), 'text');
  // A selection the browser reports takes its format from the text it starts in.
  selection.format = first.getFormat();
  $setSelection(selection);
}, { discrete: true }));

/** Pastes `text` as plain text, as a paste from a text editor does. */
export async function pastePlain(el: Element, text: string): Promise<void> {
  // jsdom has no ClipboardEvent or DataTransfer, so the event carries a stand-in holding only the text.
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { types: ['text/plain'], getData: (type: string) => (type === 'text/plain' ? text : '') } });
  await act(async () => { el.dispatchEvent(event); });
}
