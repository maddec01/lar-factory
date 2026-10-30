// Real install snapshots rendered through the page's single notification stack.
import { expect, test, vi } from 'vite-plus/test';
import type { InstallSnapshot, TargetSnapshot } from '@lar-factory/shared';
import { $, $$, mountPage, sample, settle, stubApp, text } from '../../test/support.ts';

const target: TargetSnapshot = {
  kind: 'agents', path: '~/.agents/skills', paths: ['~/.agents/skills'], locked: true, active: true, finished: false,
  instances: ['codex', 'cursor'], operation: 'install', running: true,
  skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'installing' }],
};
const installing: InstallSnapshot = {
  installs: true, installed: false, version: '1.0.0', running: 'launch', discovery: 'waiting',
  instances: [{ id: 'codex', driver: 'codex', displayName: 'Personal Codex', enabled: true },
    { id: 'cursor', driver: 'cursor', displayName: 'Cursor', enabled: false }],
  targets: [target], drift: [], replaced: [], conflicts: [], blocked: [],
};
const tray = () => $('[data-install-overview]');
const toggle = () => tray()!.querySelector<HTMLButtonElement>('[aria-expanded]')!;
function stubInstall(snapshot: InstallSnapshot) {
  snapshot = { ...snapshot, revision: snapshot.revision ?? 1, overview: snapshot.overview ?? 'open' };
  let push: (next: InstallSnapshot) => void = () => {};
  const app = stubApp({
    boardReady: vi.fn(async () => {}),
    getInstallState: vi.fn(async () => snapshot),
    closeInstallOverview: vi.fn(async (overview, revision) => {
      expect(revision).toBe(snapshot.revision);
      snapshot = { ...snapshot, overview, revision: snapshot.revision! + 1 };
      push(snapshot);
      return snapshot;
    }),
    onInstallState: vi.fn((listener) => { push = listener; return () => {}; }),
  });
  return { app, push: (next: InstallSnapshot) => settle(() => {
    snapshot = { ...next, revision: next.revision ?? snapshot.revision! + 1, overview: next.overview ?? snapshot.overview };
    push(snapshot);
  }) };
}

test('the overview starts collapsed, labels one progress bar per shared target, and follows work in both states', async () => {
  const bridge = stubInstall(installing);
  await mountPage(sample);
  expect($$('.notification-stack')).toHaveLength(1);
  expect(tray()!.closest('.notification-stack')).not.toBeNull();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(text(tray())).toContain('Personal Codex');
  expect(text(tray())).toContain('Cursor');
  expect(text(tray())).not.toContain('lar-shape');
  expect(tray()!.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  const progress = () => tray()!.querySelector('[role="progressbar"]')!;
  expect(progress().getAttribute('aria-label')).toBe('Skills installed in ~/.agents/skills');
  expect(progress().getAttribute('aria-valuenow')).toBe('1');
  expect(progress().getAttribute('aria-valuemax')).toBe('2');
  await settle(() => toggle().click());
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(text(tray())).toContain('lar-shape: Installing');
  const done = { ...installing, running: null, targets: [{ ...target, running: false, finished: true, release: '1.0.0',
    skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'installed' }] }] } satisfies InstallSnapshot;
  await bridge.push(done);
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(text(tray())).toContain('lar-shape: Installed');
  expect(text(tray())).toContain('Release 1.0.0');
  expect(progress().getAttribute('aria-valuenow')).toBe('2');
  await settle(() => toggle().click());
  await bridge.push(installing);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(progress().getAttribute('aria-valuenow')).toBe('1');
  expect(bridge.app.onInstallState).toHaveBeenCalledOnce();
});

test('expanded results name replaced Drift, failures and Clash paths without duplicate legacy notices', async () => {
  const broken: InstallSnapshot = { ...installing, running: null, targets: [
    { ...target, running: false, release: '1.0.0', replaced: ['lar-build'],
      skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'blocked' }] },
    { ...target, path: '~/.claude/skills', paths: ['~/.claude/skills'], running: false, instances: [], error: 'EACCES: permission denied',
      kind: 'claude', skills: [{ name: 'lar-build', state: 'failed' }, { name: 'lar-shape', state: 'blocked' }] },
  ], blocked: [{ skill: 'lar-shape', paths: [{ place: 'agents', path: '~/.agents/skills/lar-shape' }] }], conflicts: ['~/.agents/skills/lar-shape'] };
  stubInstall(broken);
  await mountPage(sample);
  expect(text(tray())).toContain('Installation needs attention');
  expect($('[data-warning="skill-clash"]')).toBeNull();
  expect($('[data-warning="skill-install-failed"]')).toBeNull();
  await settle(() => toggle().click());
  expect(text(tray())).toContain('Replaced Drift: lar-build');
  expect(text(tray())).toContain('Clash at ~/.agents/skills/lar-shape');
  expect(text(tray())).toContain('lar-shape: Blocked by source Clash');
  expect(text(tray())).not.toContain('Clash at ~/.claude/skills/lar-shape');
  expect(text(tray())).toContain('~/.claude/skills: EACCES: permission denied');
  expect(text(tray())).not.toContain("skills are installed");
  expect(tray()!.closest('[data-slot="toast"]')!.getAttribute('aria-live')).toBe('off');
  expect(tray()!.querySelector('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
});

test('a same-Release check shows real Drift without an install overview, and later new-target work can open one', async () => {
  const check: InstallSnapshot = { ...installing, running: null, targets: [{ ...target, operation: 'check', running: false, release: '1.0.0',
    skills: [{ name: 'lar-build', state: 'drift' }] }],
    drift: [{ skill: 'lar-build', paths: [{ place: 'agents', path: '~/.agents/skills/lar-build' }] }] };
  const bridge = stubInstall(check);
  await mountPage(sample);
  expect(tray()).toBeNull();
  expect(text($('[data-warning="drift"]'))).toContain('lar-build');
  await bridge.push({ ...check, running: 'discovery', targets: [...check.targets, { ...target, path: '~/.claude/skills', paths: ['~/.claude/skills'] }] });
  expect(tray()).not.toBeNull();
  expect(text($('[data-warning="drift"]'))).toContain('lar-build');
});

test('reopening a page recovers in-flight work from a read without retrying installation', async () => {
  const bridge = stubInstall(installing);
  await mountPage(sample);
  expect(tray()).not.toBeNull();
  expect(bridge.app.getInstallState).toHaveBeenCalledOnce();
  expect(bridge.app.boardReady).not.toHaveBeenCalled();
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
});

test.each([
  ['normal', sample, ''],
  ['empty', { ...sample, repos: [], items: [], onboarding: [] }, ''],
  ['missing T3', { ...sample, tools: { ...sample.tools, t3: { result: 'missing' as const, fix: 'Install T3 Code' } } }, ''],
  ['Settings', sample, '#settings/skills'],
])('the overview shares one stack on the %s screen', async (_name, board, hash) => {
  stubInstall(installing);
  await mountPage(board, hash);
  expect($$('.notification-stack')).toHaveLength(1);
  expect(tray()).not.toBeNull();
});

test('dismissing the overview restores focus and does not cancel or restart installation', async () => {
  const bridge = stubInstall(installing);
  await mountPage(sample);
  const dismiss = tray()!.querySelector<HTMLButtonElement>('.dismiss')!;
  await settle(() => dismiss.focus());
  await settle(() => dismiss.click());
  expect(tray()).toBeNull();
  expect(document.activeElement).toBe($('.add-item'));
  await bridge.push({ ...installing, targets: [{ ...target, replaced: ['lar-build'] }] });
  expect(tray()).toBeNull();
  expect(bridge.app.boardReady).not.toHaveBeenCalled();
});

test('Clashes report the path that actually blocks an aliased target', async () => {
  stubInstall({ ...installing, targets: [{ ...target, paths: [...target.paths, '~/linked/skills'], running: false,
    skills: [{ name: 'lar-shape', state: 'blocked' }] }], blocked: [{ skill: 'lar-shape', paths: [{ place: 'agents', path: '~/linked/skills/lar-shape' }] }] });
  await mountPage(sample);
  await settle(() => toggle().click());
  expect(text(tray())).toContain('Clash at ~/linked/skills/lar-shape');
});

test('adding discovered targets keeps the expanded view and completed results in place', async () => {
  const bridge = stubInstall(installing);
  await mountPage(sample);
  await settle(() => toggle().click());
  const summary = tray()!.querySelector('[role="status"]')!;
  const announcement = text(summary);
  await bridge.push({ ...installing, targets: [{ ...target, skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'pending' }] }] });
  expect(text(summary), 'per-skill updates leave the announcement alone').toBe(announcement);
  await bridge.push({ ...installing, discovery: 'available', targets: [{ ...target, finished: true, running: false, release: '1.0.0',
    skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'installed' }] },
    { ...target, path: '~/.claude/skills', paths: ['~/.claude/skills'], instances: [] }] });
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect(tray()!.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  expect(text(tray())).toContain('Release 1.0.0 · Installed');
  expect(text(tray())).toContain('lar-shape: Installing');
});

test('browser runs and development apps without installation enabled show no overview', async () => {
  stubInstall({ ...installing, installs: false });
  await mountPage(sample);
  expect(tray()).toBeNull();
});

test('a clean same-Release check does not announce a reinstall or a success overview', async () => {
  stubInstall({ ...installing, installed: true, running: null, targets: [{ ...target, operation: 'check', running: false,
    finished: true, release: '1.0.0', skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'installed' }] }] });
  await mountPage(sample);
  expect(tray()).toBeNull();
});

test('a selected target with a missing provider home stays visible with its reader and availability', async () => {
  stubInstall({ ...installing, instances: [...installing.instances, { id: 'work', displayName: 'Work Claude', driver: 'claudeAgent', enabled: true }],
    targets: [target, { ...target, kind: 'claude', path: '~/Profiles/claude-gone/skills', paths: ['~/Profiles/claude-gone/skills'],
      active: false, homeMissing: true, operation: undefined, running: false, instances: ['work'], skills: [{ name: 'lar-build', state: 'missing' }] }] });
  await mountPage(sample);
  expect(tray()!.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  expect(text(tray())).toContain('Work Claude');
  expect(text(tray())).toContain('Not installed until ~/Profiles/claude-gone exists.');
});

const succeeded: InstallSnapshot = { ...installing, installed: true, running: null, targets: [{ ...target,
  running: false, finished: true, release: '1.0.0',
  skills: [{ name: 'lar-build', state: 'installed' }, { name: 'lar-shape', state: 'installed' }],
}] };

test('installation stays open through progress and closes five seconds after every target succeeds', async () => {
  const bridge = stubInstall(installing);
  await mountPage(sample);
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(tray()).not.toBeNull();
  await bridge.push(succeeded);
  await settle(() => vi.advanceTimersByTime(4_999));
  expect(tray()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(1));
  expect(tray()).toBeNull();
});

test('success waits for hover and focus to leave, then starts a full five seconds', async () => {
  const bridge = stubInstall(installing);
  await mountPage(sample);
  const entry = tray()!.closest('[data-slot="toast"]')!;
  await settle(() => entry.dispatchEvent(new MouseEvent('mouseenter')));
  await settle(() => toggle().focus());
  await bridge.push(succeeded);
  await settle(() => vi.advanceTimersByTime(10_000));
  expect(tray()).not.toBeNull();
  await settle(() => entry.dispatchEvent(new MouseEvent('mouseleave')));
  await settle(() => vi.advanceTimersByTime(10_000));
  expect(tray()).not.toBeNull();
  await settle(() => tray()!.querySelector<HTMLButtonElement>('.dismiss')!.focus());
  await settle(() => vi.advanceTimersByTime(10_000));
  expect(tray()).not.toBeNull();
  await settle(() => (document.activeElement as HTMLElement).blur());
  await settle(() => vi.advanceTimersByTime(4_999));
  expect(tray()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(1));
  expect(tray()).toBeNull();
});

test.each(['global error', 'partial failure', 'Clash', 'incomplete', 'running'])('%s prevents automatic success closure', async (condition) => {
  const snapshot: InstallSnapshot = condition === 'global error' ? { ...succeeded, error: 'Cannot read install targets' }
    : condition === 'partial failure' ? { ...succeeded, targets: [...succeeded.targets, { ...target, path: '~/late/skills',
      running: false, finished: false, error: 'EACCES: permission denied', skills: [{ name: 'lar-build', state: 'failed' }] }] }
    : condition === 'Clash' ? { ...succeeded, blocked: [{ skill: 'lar-build', paths: [{ place: 'agents', path: '~/late/skills/lar-build' }] }] }
    : condition === 'running' ? { ...succeeded, running: 'discovery' }
    : { ...succeeded, targets: [...succeeded.targets, { ...target, running: false }] };
  stubInstall(snapshot);
  await mountPage(sample);
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(tray()).not.toBeNull();
});

test('late work cancels the success timer and progress updates preserve one expanded notification', async () => {
  const bridge = stubInstall(succeeded);
  await mountPage(sample);
  await settle(() => toggle().click());
  await settle(() => (document.activeElement as HTMLElement).blur());
  const entry = tray();
  await settle(() => vi.advanceTimersByTime(4_900));
  const late: InstallSnapshot = { ...succeeded, running: 'discovery', discovery: 'available', targets: [...succeeded.targets,
    { ...target, path: '~/late/skills', paths: ['~/late/skills'], instances: [] }] };
  await bridge.push(late);
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(tray()).toBe(entry);
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  expect($$('[data-install-overview]')).toHaveLength(1);
  expect(text(tray())).toContain('Release 1.0.0 · Installed');
  await bridge.push({ ...late, running: null, targets: [...succeeded.targets, { ...succeeded.targets[0]!, path: '~/late/skills', paths: ['~/late/skills'] }] });
  await settle(() => entry!.closest('[data-slot="toast"]')!.dispatchEvent(new MouseEvent('mouseleave')));
  await settle(() => vi.advanceTimersByTime(4_900));
  await bridge.push({ ...late, running: null, targets: [...succeeded.targets, { ...succeeded.targets[0]!, path: '~/late/skills', paths: ['~/late/skills'] }] });
  await settle(() => vi.advanceTimersByTime(100));
  expect(tray()).toBeNull();
});

test.each(['automatic', 'dismissed'] as const)('a reopened page recovers %s closure and follows the desktop decision for late work', async (overview) => {
  const bridge = stubInstall({ ...succeeded, overview });
  await mountPage(sample);
  expect(tray()).toBeNull();
  await bridge.push({ ...installing, overview: overview === 'automatic' ? 'open' : 'dismissed', running: 'discovery',
    targets: [...succeeded.targets, { ...target, path: '~/late/skills', paths: ['~/late/skills'] }] });
  expect(!!tray()).toBe(overview === 'automatic');
  expect(bridge.app.getInstallState).toHaveBeenCalledOnce();
  expect(bridge.app.boardReady).not.toHaveBeenCalled();
});

test.each(['automatic', 'dismissed'] as const)('%s closure stays closed across reload, with Settings results and the correct late-discovery behavior', async (reason) => {
  const bridge = stubInstall(reason === 'automatic' ? succeeded : installing);
  await mountPage(sample);
  if (reason === 'automatic') await settle(() => vi.advanceTimersByTime(5_000));
  else await settle(() => tray()!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(tray()).toBeNull();
  expect(bridge.app.closeInstallOverview).toHaveBeenCalledWith(reason, 1);
  const { useInstallStore } = await import('../settings/install-store.ts');
  expect(useInstallStore.getState().snapshot?.targets).toEqual(reason === 'automatic' ? succeeded.targets : installing.targets);

  vi.resetModules();
  await mountPage(sample);
  expect(tray()).toBeNull();
  expect(bridge.app.getInstallState).toHaveBeenCalledTimes(2);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((button) => text(button) === 'Skills')!.click());
  expect(text($('.settings-body'))).toContain('~/.agents/skills');
  await bridge.push({ ...installing, overview: reason === 'automatic' ? 'open' : 'dismissed', running: 'discovery',
    targets: [...succeeded.targets, { ...target, path: '~/late/skills', paths: ['~/late/skills'] }] });
  expect(!!tray()).toBe(reason === 'automatic');
  expect(bridge.app.closeInstallOverview).toHaveBeenCalledOnce();
  expect(bridge.app.boardReady).not.toHaveBeenCalled();
});

test('a pending desktop dismissal stays hidden through progress pushes until acknowledgement', async () => {
  const bridge = stubInstall(installing);
  let acknowledge!: (snapshot: InstallSnapshot) => void;
  bridge.app.closeInstallOverview.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
  await mountPage(sample);
  await settle(() => tray()!.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(tray()).toBeNull();
  await bridge.push({ ...installing, overview: 'open' });
  expect(tray()).toBeNull();
  await settle(() => acknowledge({ ...installing, revision: 3, overview: 'dismissed' }));
  expect(tray()).toBeNull();
  const { useInstallStore } = await import('../settings/install-store.ts');
  expect(useInstallStore.getState().snapshot?.overview).toBe('dismissed');
});

test('late work pushed before an automatic-close acknowledgement wins over its older reply', async () => {
  const bridge = stubInstall(succeeded);
  let acknowledge!: (snapshot: InstallSnapshot) => void;
  bridge.app.closeInstallOverview.mockImplementationOnce(() => new Promise((resolve) => { acknowledge = resolve; }));
  await mountPage(sample);
  await settle(() => vi.advanceTimersByTime(5_000));
  await bridge.push({ ...installing, overview: 'open', revision: 3, running: 'discovery',
    targets: [...succeeded.targets, { ...target, path: '~/late/skills', paths: ['~/late/skills'] }] });
  await settle(() => acknowledge({ ...succeeded, overview: 'automatic', revision: 2 }));
  expect(tray()).not.toBeNull();
  expect(tray()!.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(tray()).not.toBeNull();
});
