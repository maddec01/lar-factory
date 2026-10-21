// Saved-copy test: renders test/sample.json and compares it with test/expected/.
// Run `npm run test:update` to rewrite the saved copies after a deliberate change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderPage } from '../src/page.ts';
import { DEFAULT_UI, renderBoardView, renderFlowView } from '../src/render.ts';
import type { RenderOptions } from '../src/render.ts';
import type { BoardData } from '../src/model.ts';

const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as BoardData;
const expectedDir = new URL('./expected/', import.meta.url);
const update = process.env.UPDATE_EXPECTED === '1';

// Fixed clock and zone so the output doesn't depend on when or where it runs.
const base: RenderOptions = { now: Date.parse('2026-10-21T10:00:00Z'), timeZone: 'UTC', ui: DEFAULT_UI };

function matchesSaved(name: string, actual: string): void {
  const file = new URL(name, expectedDir);
  if (update) {
    mkdirSync(expectedDir, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  const expected = readFileSync(file, 'utf8');
  assert.equal(actual, expected, `${name} differs from the saved copy; run npm run test:update if intended`);
}

test('page: header, stale banner and both views', () => {
  matchesSaved('page.html', renderPage(sample, base));
});

test('board view, with List and Done expanded', () => {
  matchesSaved(
    'board.html',
    renderBoardView(sample, { ...base, ui: { ...DEFAULT_UI, open: ['list-server', 'list-apple', 'list-draft', 'done-list'] } }),
  );
});

test('flow view, all paths', () => {
  matchesSaved('flow.html', renderFlowView(sample, { ...base, ui: { ...DEFAULT_UI, view: 'flow' } }));
});

test('flow view, foggy concept tab', () => {
  matchesSaved('flow-fog.html', renderFlowView(sample, { ...base, ui: { ...DEFAULT_UI, view: 'flow', flowTab: 'fog' } }));
});
