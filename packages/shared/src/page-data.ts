// Puts the board's data into the built index.html for its first paint. The server sends the
// result; the page's tests mount it.

import type { BoardData } from './model.ts';

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/** Puts the board data into index.html's <script id="board-data">. */
export function pageWithData(template: string, data: BoardData): string {
  // A function, so a `$` in the board data is never read as a replacement pattern.
  return template.replace('<!--board-data-->', () => scriptJson(data));
}
