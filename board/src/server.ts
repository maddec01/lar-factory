// The board server: refreshes the project through `gh` every refreshSeconds,
// keeps the last good copy in memory and serves it on 127.0.0.1.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { loadConfig } from './config.ts';
import { fetchProject, findProjectNumber } from './github.ts';
import { renderPage } from './page.ts';
import { DEFAULT_UI } from './render.ts';
import type { BoardData } from './model.ts';

const HOST = '127.0.0.1';
const config = loadConfig();

const state: BoardData = {
  project: { title: config.title, url: null },
  repos: config.repos,
  refreshSeconds: config.refreshSeconds,
  fetchedAt: null,
  error: null,
  items: [],
};

let projectNumber = config.number;
let refreshing = false;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    projectNumber ??= await findProjectNumber(config.owner, config.title);
    const snapshot = await fetchProject(config.owner, projectNumber);
    const recovered = state.error !== null || state.fetchedAt === null;
    state.project = { title: snapshot.title, url: snapshot.url };
    state.items = snapshot.items;
    state.fetchedAt = new Date().toISOString();
    state.error = null;
    if (recovered) log(`read ${snapshot.items.length} items from ${snapshot.url}`);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    log(`refresh failed, serving data from ${state.fetchedAt ?? 'never'}: ${state.error}`);
  } finally {
    refreshing = false;
  }
}

// Browser modules: the shared template is served as JS by stripping its types.
const ASSETS = new Set(['client.ts', 'render.ts', 'model.ts']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

/** Only answer requests addressed to this machine, to block DNS rebinding. */
function allowedHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return [`127.0.0.1:${config.port}`, `localhost:${config.port}`].includes(host);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowedHost(req)) return send(res, 421, 'text/plain; charset=utf-8', 'Misdirected request\n');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
  }
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', renderPage(state, { now: Date.now(), ui: DEFAULT_UI }));
  }
  if (path === '/api/board') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state));
  if (path === '/healthz') return send(res, 200, 'text/plain; charset=utf-8', 'ok\n');
  const asset = path.startsWith('/assets/') ? path.slice('/assets/'.length) : '';
  if (ASSETS.has(asset)) {
    const source = await readFile(new URL(`./${asset}`, import.meta.url), 'utf8');
    return send(res, 200, 'text/javascript; charset=utf-8', stripTypeScriptTypes(source));
  }
  send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    log(`request ${req.url} failed: ${err instanceof Error ? err.stack : String(err)}`);
    if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal error\n');
  });
});

server.listen(config.port, HOST, () => {
  log(`board on http://${HOST}:${config.port}, refreshing every ${config.refreshSeconds} s`);
});

// BOARD_DATA_FILE serves a fixed JSON file instead of reading GitHub (for
// trying the layout, e.g. with test/sample.json).
const fixture = process.env.BOARD_DATA_FILE;
if (fixture) {
  Object.assign(state, JSON.parse(readFileSync(fixture, 'utf8')) as BoardData);
  log(`serving ${fixture} instead of GitHub`);
} else await refresh();
const timer = setInterval(() => void (fixture || refresh()), config.refreshSeconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
