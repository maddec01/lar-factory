// The board app's Drift warning in the shared notification stack, with its Replace.

import { expect, test, vi } from 'vite-plus/test';
import type { InstallOperationResult, InstallSnapshot } from '@lar-factory/shared';
import { $, $$, mountPage, sample, settle, stubApp, text, warningText } from '../../test/support.ts';

const drifted = (skills: string[]): InstallSnapshot => ({
  installs: true, installed: true, version: '0.2.0', running: null, discovery: 'available', instances: [], targets: [],
  drift: skills.flatMap((skill) => [
    { skill, paths: [{ place: 'agents' as const, path: `~/.agents/skills/${skill}` }] },
    { skill, paths: [{ place: 'agents' as const, path: `~/.work/skills/${skill}` }] },
  ]),
  replaced: [], conflicts: [], blocked: [],
});

const warning = () => $('[data-warning="drift"]')?.closest<HTMLElement>('[data-slot="toast"]') ?? null;
const replaceButton = () => warning()!.querySelector<HTMLButtonElement>('[data-replace-drift]')!;

/** The app's bridge with `snapshot` as its install state, whose Replace answers with `replaced`. */
function stubInstall(snapshot: InstallSnapshot, replaced: () => Promise<InstallOperationResult>) {
  let push: (next: InstallSnapshot) => void = () => {};
  const bridge = stubApp({
    getInstallState: vi.fn(async () => snapshot),
    onInstallState: (listener: (next: InstallSnapshot) => void) => { push = listener; return () => {}; },
    replaceDrift: vi.fn(replaced),
  });
  return Object.assign(bridge, { push: (next: InstallSnapshot) => settle(() => push(next)) });
}

test('Drift at launch posts one warning naming each skill once, and Replace replaces it', async () => {
  let finish: (result: InstallOperationResult) => void = () => {};
  const bridge = stubInstall(drifted(['lar-shape', 'lar-build']), () => new Promise((resolve) => { finish = resolve; }));
  await mountPage(sample);
  await settle();
  expect($$('[data-warning="drift"]')).toHaveLength(1);
  expect(warningText(warning()!)).toEqual(["Some of lar's skills changed.",
    "lar-shape and lar-build changed since Lar Factory installed them. Replace puts this Release's copy back; Start build asks again."]);
  await settle(() => replaceButton().click());
  expect(bridge.replaceDrift).toHaveBeenCalledOnce();
  expect([text(replaceButton()), replaceButton().disabled]).toEqual(['Replacing…', true]);
  await settle(() => replaceButton().click());
  expect(bridge.replaceDrift).toHaveBeenCalledOnce();
  await settle(() => finish({ snapshot: drifted([]) }));
  expect(warning()).toBeNull();
});

test('a failed Replace keeps the warning and says why', async () => {
  stubInstall(drifted(['lar-build']), async () => ({ snapshot: drifted(['lar-build']), error: 'EACCES: ~/.agents/skills' }));
  await mountPage(sample);
  await settle();
  await settle(() => replaceButton().click());
  expect(text(warning()!.querySelector('[role="alert"]'))).toBe("Couldn't replace it: EACCES: ~/.agents/skills");
  expect(replaceButton().disabled).toBe(false);
});

test('Drift the app finds later shows, and goes once it is gone', async () => {
  const bridge = stubInstall(drifted([]), async () => ({ snapshot: drifted([]) }));
  await mountPage(sample);
  await settle();
  expect(warning()).toBeNull();
  await bridge.push(drifted(['lar-build']));
  expect(warning()).not.toBeNull();
  await bridge.push(drifted([]));
  expect(warning()).toBeNull();
});

test('a closed Drift warning comes back when other skills drift, even as many as before', async () => {
  const bridge = stubInstall(drifted(['lar-build']), async () => ({ snapshot: drifted([]) }));
  await mountPage(sample);
  await settle();
  await settle(() => warning()!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(warning()).toBeNull();
  await bridge.push(drifted(['lar-build']));
  expect(warning()).toBeNull();
  await bridge.push(drifted(['lar-shape']));
  expect(warningText(warning()!)[1]).toMatch(/^lar-shape changed/);
});

test('a closed Drift warning stays closed when fewer skills drift', async () => {
  const bridge = stubInstall(drifted(['lar-build', 'lar-shape']), async () => ({ snapshot: drifted([]) }));
  await mountPage(sample);
  await settle();
  await settle(() => warning()!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  await bridge.push(drifted(['lar-shape']));
  expect(warning()).toBeNull();
});

test('a page outside the board app shows no Drift warning', async () => {
  await mountPage(sample);
  await settle();
  expect(warning()).toBeNull();
});

test('a failed target replacement keeps Drift actionable and names the failure without a command error', async () => {
  const failed: InstallSnapshot = { ...drifted(['lar-build']), targets: [{
    kind: 'agents', path: '~/.agents/skills', paths: ['~/.agents/skills'], locked: true, active: true, finished: false,
    instances: [], skills: [{ name: 'lar-build', state: 'failed' }], error: 'EACCES: copy denied',
  }] };
  stubInstall(drifted(['lar-build']), async () => ({ snapshot: failed }));
  await mountPage(sample);
  await settle();
  await settle(() => replaceButton().click());
  expect(text(warning()!.querySelector('[role="alert"]'))).toContain('EACCES: copy denied');
  expect(replaceButton().disabled).toBe(false);
  expect($$('[data-warning="drift"]')).toHaveLength(1);
});
