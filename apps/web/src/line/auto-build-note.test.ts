// A Ready row's note from Auto-build: a paused build's error, and the wait for its concept's Refinement while the switch is on.

import { expect, test } from 'vite-plus/test';
import type { BoardData } from '@lar-factory/shared';
import { $, mountPage, sample, text } from '../../test/support.ts';

const READY = 'I_sample13';
const live = (on: boolean, pass: Partial<NonNullable<BoardData['autoBuildPass']>>): BoardData =>
  ({ ...sample, autoBuild: { on }, autoBuildPass: { wouldStart: 0, paused: {}, waitsForRefinement: [], ...pass } });

test("a paused build's row shows why its automatic start failed", async () => {
  await mountPage(live(false, { paused: { [READY]: 'T3 started no thread.' } }));
  expect(text($(`[data-item="${READY}"] [data-auto-build-paused]`))).toBe('Auto-build paused: T3 started no thread.');
});

test('a build under a concept still refining says Auto-build waits for Refinement while the switch is on', async () => {
  await mountPage(live(true, { waitsForRefinement: [READY] }));
  expect(text($(`[data-item="${READY}"] [data-auto-build-waits]`))).toBe('Auto-build waits for Refinement');
});

test('with the switch off the row says nothing of Refinement', async () => {
  await mountPage(live(false, { waitsForRefinement: [READY] }));
  expect($(`[data-item="${READY}"] [data-auto-build-waits]`)).toBeNull();
});
