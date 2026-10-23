// The full HTML document the server sends on first load: the built index.html, filled with the
// board's data for the page's first paint, and the built assets it loads. Server-only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { BRAND_MARK } from './brand-mark.ts';
import type { BoardData } from './model.ts';

/** The logo in a mid grey that reads on light and dark tabs. */
const favicon = `data:image/svg+xml,${encodeURIComponent(BRAND_MARK.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ').replace('currentColor', '#71717b'))}`;

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export interface Asset {
  type: string;
  body: Buffer;
}

/** What `vp build` wrote: index.html and the files under /assets/, by name. */
export interface BuiltPage {
  template: string;
  assets: Map<string, Asset>;
}

/** Reads the build once, so the board keeps serving the page it started with while the checkout moves on. */
export function loadBuild(dir = new URL('../dist/', import.meta.url)): BuiltPage {
  const index = new URL('index.html', dir);
  if (!existsSync(index)) throw new Error(`No built page at ${index.pathname}: run pnpm run build in board/`);
  const assetsDir = new URL('assets/', dir);
  const assets = new Map<string, Asset>();
  for (const name of existsSync(assetsDir) ? readdirSync(assetsDir) : []) {
    assets.set(name, { type: TYPES[extname(name)] ?? 'application/octet-stream', body: readFileSync(new URL(name, assetsDir)) });
  }
  return { template: readFileSync(index, 'utf8'), assets };
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}

/** Fills index.html's <!--board-head--> and <!--board-body--> with the favicon, the app's root and the board data. */
export function renderPage(template: string, data: BoardData): string {
  const body = `<div id="app"></div>
<script id="board-data" type="application/json">${scriptJson(data)}</script>`;
  // Functions, so a `$` in the board data is never read as a replacement pattern.
  return template
    .replace('<!--board-head-->', () => `<link rel="icon" href="${favicon}">`)
    .replace('<!--board-body-->', () => body);
}
