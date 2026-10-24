// The page the server sends on first load: the built index.html and the built assets it loads.
// pageWithData, in @mux-factory/shared, puts the board's data in it. Server-only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

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

/** Reads the build in `dir` once, so the board keeps serving the page it started with while the checkout moves on. */
export function loadBuild(dir: URL): BuiltPage {
  const index = new URL('index.html', dir);
  if (!existsSync(index)) throw new Error(`No built page at ${index.pathname}: run pnpm run build in apps/web/`);
  const assetsDir = new URL('assets/', dir);
  const assets = new Map<string, Asset>();
  for (const name of existsSync(assetsDir) ? readdirSync(assetsDir) : []) {
    assets.set(name, { type: TYPES[extname(name)] ?? 'application/octet-stream', body: readFileSync(new URL(name, assetsDir)) });
  }
  return { template: readFileSync(index, 'utf8'), assets };
}
