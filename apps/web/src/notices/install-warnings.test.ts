// The board app's Clash and install-failure warnings in the shared notification stack, each with its Retry.

import { expect, test, vi } from 'vite-plus/test';
import type { InstallOperationResult, InstallSnapshot } from '@lar-factory/shared';
import { $, mountPage, sample, settle, stubApp, text, warningText } from '../../test/support.ts';

const clean: InstallSnapshot = {
  installs: true, installed: true, version: '0.2.0', running: null, discovery: 'available', instances: [], targets: [],
  drift: [], replaced: [], conflicts: [], blocked: [],
};
const clashed: InstallSnapshot = {
  ...clean, conflicts: ['~/.claude/skills/lar-build'],
  blocked: [{ skill: 'lar-build', paths: [{ place: 'profile', profile: '.claude', path: '~/.claude/skills/lar-build' }] }],
};
const failed: InstallSnapshot = {
  ...clean,
  targets: [{ kind: 'antigravity', path: '~/.gemini/config/skills', paths: ['~/.gemini/config/skills'], locked: true, active: true, finished: false,
    instances: [], skills: [], error: 'EACCES: permission denied' }],
};

const warning = (key: string) => $(`[data-warning="${key}"]`)?.closest<HTMLElement>('[data-slot="toast"]') ?? null;
const retryButton = (key: string) => warning(key)!.querySelector<HTMLButtonElement>('[data-retry-install]')!;

function stubInstall(snapshot: InstallSnapshot, retried: () => Promise<InstallOperationResult>) {
  let push: (next: InstallSnapshot) => void = () => {};
  const bridge = stubApp({
    getInstallState: vi.fn(async () => snapshot),
    onInstallState: (listener: (next: InstallSnapshot) => void) => { push = listener; return () => {}; },
    retryInstall: vi.fn(retried),
  });
  return Object.assign(bridge, { push: (next: InstallSnapshot) => settle(() => push(next)) });
}

test('a Clash posts a warning naming the target and skill, and Retry checks again', async () => {
  let finish: (result: InstallOperationResult) => void = () => {};
  const bridge = stubInstall(clashed, () => new Promise((resolve) => { finish = resolve; }));
  await mountPage(sample);
  await settle();
  expect(warningText(warning('skill-clash')!)).toEqual(["A folder blocks one of lar's skills.",
    "lar-build in ~/.claude/skills isn't Lar Factory's, so it left it alone. Rename or remove it, then Retry. Start build stays refused until then."]);
  await settle(() => retryButton('skill-clash').click());
  expect(bridge.retryInstall).toHaveBeenCalledOnce();
  expect([text(retryButton('skill-clash')), retryButton('skill-clash').disabled]).toEqual(['Retrying…', true]);
  await settle(() => finish({ snapshot: clean }));
  expect(warning('skill-clash')).toBeNull();
});

test('a failed install posts a warning naming each target and why, and a failed Retry says why', async () => {
  stubInstall(failed, async () => ({ snapshot: failed, error: 'T3 Code went away' }));
  await mountPage(sample);
  await settle();
  expect(warningText(warning('skill-install-failed')!)).toEqual(["Lar Factory couldn't install its skills.",
    '~/.gemini/config/skills: EACCES: permission denied. Retry tries again; Start build stays refused until it works.']);
  await settle(() => retryButton('skill-install-failed').click());
  expect(text(warning('skill-install-failed')!.querySelector('[role="alert"]'))).toBe("Couldn't retry: T3 Code went away");
});

test('a Clash the app finds later shows', async () => {
  const bridge = stubInstall(clean, async () => ({ snapshot: clean }));
  await mountPage(sample);
  await settle();
  expect(warning('skill-clash')).toBeNull();
  await bridge.push(clashed);
  expect(warning('skill-clash')).not.toBeNull();
});

test('a closed Clash warning comes back when another path blocks a skill, even as many as before', async () => {
  const bridge = stubInstall(clashed, async () => ({ snapshot: clashed }));
  await mountPage(sample);
  await settle();
  await settle(() => warning('skill-clash')!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(warning('skill-clash')).toBeNull();
  await bridge.push({ ...clashed, blocked: [{ skill: 'lar-build', paths: [{ place: 'agents', path: '~/.agents/skills/lar-build' }] }] });
  expect(warning('skill-clash')).not.toBeNull();
});

test('a closed failure warning comes back when another target fails, even as many as before', async () => {
  const bridge = stubInstall(failed, async () => ({ snapshot: failed }));
  await mountPage(sample);
  await settle();
  await settle(() => warning('skill-install-failed')!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(warning('skill-install-failed')).toBeNull();
  await bridge.push({ ...failed, targets: [{ ...failed.targets[0]!, path: '~/.gemini/antigravity-cli/skills' }] });
  expect(warning('skill-install-failed')).not.toBeNull();
});

test('a closed Clash warning stays closed when fewer paths block skills', async () => {
  const twice: InstallSnapshot = {
    ...clashed, blocked: [{ skill: 'lar-build', paths: [...clashed.blocked[0]!.paths, { place: 'agents', path: '~/.agents/skills/lar-build' }] }],
  };
  const bridge = stubInstall(twice, async () => ({ snapshot: twice }));
  await mountPage(sample);
  await settle();
  await settle(() => warning('skill-clash')!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  await bridge.push(clashed);
  expect(warning('skill-clash')).toBeNull();
});

test('a closed failure warning stays closed when the same target fails with other words', async () => {
  const bridge = stubInstall(failed, async () => ({ snapshot: failed }));
  await mountPage(sample);
  await settle();
  await settle(() => warning('skill-install-failed')!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  await bridge.push({ ...failed, targets: [{ ...failed.targets[0]!, error: 'EPERM: operation not permitted' }] });
  expect(warning('skill-install-failed')).toBeNull();
});
