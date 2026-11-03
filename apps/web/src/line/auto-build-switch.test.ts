// The Shaping header's Auto-build switch: off until the board says it's on, disabled in sample mode, and saved on the
// board server when pressed.

import { expect, test } from 'vite-plus/test';
import type { BoardData } from '@lar-factory/shared';
import { $, answer, holdPosts, mountPage, posted, sample, settle, text, toast } from '../../test/support.ts';

const control = () => $<HTMLButtonElement>('[data-stage="shaping"] header [role="switch"][aria-label="Auto-build"]')!;
const on = () => control().getAttribute('aria-checked') === 'true';
const live = (autoBuild: BoardData['autoBuild']): BoardData => ({ ...sample, capture: { session: 's1', enabled: true }, autoBuild });

test('the switch sits in the Shaping header, off for a board with Auto-build off', async () => {
  await mountPage(live({ on: false }));
  expect(text($('[data-stage="shaping"] header .auto-build'))).toBe('Auto-build');
  expect([on(), control().disabled]).toEqual([false, false]);
});

test('the switch is disabled in sample mode, which has no Auto-build', async () => {
  await mountPage(sample);
  expect([on(), control().disabled]).toEqual([false, true]);
  expect($('[data-stage="shaping"] header .auto-build')!.title).toBe('Disabled in sample mode');
});

test("a file the board can't use shows the switch off with why", async () => {
  await mountPage(live({ on: false, problem: "The Auto-build setting /data/auto-build.json isn't JSON." }));
  expect(on()).toBe(false);
  expect($('[data-stage="shaping"] header .auto-build')!.title).toBe("The Auto-build setting /data/auto-build.json isn't JSON. Turning it on replaces the file.");
});

test('pressing the switch saves it and shows the board the server answers with', async () => {
  await mountPage(live({ on: false }));
  holdPosts(live({ on: false }));
  await settle(() => control().click());
  expect(posted()).toEqual([['/api/auto-build', { on: true }]]);
  expect([on(), control().getAttribute('aria-disabled')], 'busy while it saves').toEqual([true, 'true']);
  await answer({ error: null, board: live({ on: true }) });
  expect([on(), control().getAttribute('aria-disabled')]).toEqual([true, 'false']);
  holdPosts(live({ on: true }));
  await settle(() => control().click());
  await answer({ error: null, board: live({ on: false }) });
  expect(on()).toBe(false);
});

test("a refused save leaves the switch as the board has it and says why", async () => {
  await mountPage(live({ on: false }));
  holdPosts(live({ on: false }));
  await settle(() => control().click());
  await answer({ error: "Can't save the Auto-build setting /data/auto-build.json: EACCES.", board: live({ on: false }) }, 500);
  expect(on()).toBe(false);
  expect(text(toast())).toContain("Can't save the Auto-build setting /data/auto-build.json: EACCES.");
});
