// The page the server sends on first load: the built index.html with the board's data for its
// first paint, and the built assets it loads. Server-only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { BoardData } from './model.ts';

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

/** Puts the board data into index.html's <script id="board-data">. */
export function pageWithData(template: string, data: BoardData): string {
  // A function, so a `$` in the board data is never read as a replacement pattern.
  return template.replace('<!--board-data-->', () => scriptJson(data));
}
