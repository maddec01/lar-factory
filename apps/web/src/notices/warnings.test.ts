import { expect, test, vi } from 'vite-plus/test';
import { $, $$, mountPage, push, sample, settle, stream, toolChecks } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';

const healthy: BoardData = { ...sample, tools: toolChecks(), repositoryConfigProblems: [], itemSourceProblems: [] };
const warning = (key: string) => $(`[data-warning="${key}"]`)?.closest<HTMLElement>('[data-slot="toast"]') ?? null;
const closeWarning = (key: string) => settle(() => warning(key)!.querySelector<HTMLButtonElement>('.dismiss')!.click());

test('a tool warning stays amber in the shared stack until its condition clears', async () => {
  await mountPage({ ...sample, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
  const warning = $('[data-slot="toaster"] [data-toast-color="warning"]')!;
  expect(warning).not.toBeNull();
  expect(warning.textContent).toContain('GitHub CLI not found.');
  expect(warning.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: GitHub CLI not found.');
  expect($('main .banner, main .banners')).toBeNull();
  await settle(() => stream().onopen!());
  await settle(() => vi.advanceTimersByTime(60_000));
  expect($$('[data-toast-color="warning"]')).toEqual([warning]);
  await push({ ...sample, tools: toolChecks() });
  expect($('[data-toast-color="warning"]')).toBeNull();
});

const conditions: { key: string; failed: Partial<BoardData>; changed: Partial<BoardData> }[] = [
  { key: 't3', failed: { tools: toolChecks({ t3: { result: 'not-running' } }) }, changed: { tools: toolChecks({ t3: { result: 'not-running', version: '1.0.0' } }) } },
  { key: 'gh', failed: { tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) }, changed: { tools: toolChecks({ gh: { result: 'logged-out', fix: 'gh auth login' } }) } },
  ...(['git', 'jq', 'curl'] as const).map((name) => ({
    key: name,
    failed: { tools: toolChecks({ [name]: { result: 'missing', fix: `brew install ${name}` } }) },
    changed: { tools: toolChecks({ [name]: { result: 'missing', fix: `brew install ${name}`, override: `${name.toUpperCase()}_PATH=/missing/${name}` } }) },
  })),
  { key: 'az', failed: { tools: toolChecks({ az: { result: 'missing', fix: 'brew install azure-cli' } }) }, changed: { tools: toolChecks({ az: { result: 'logged-out', fix: 'az login' } }) } },
  { key: 'repository-config:owner/repo', failed: { repositoryConfigProblems: [{ repo: 'owner/repo', problem: 'no config' }] }, changed: { repositoryConfigProblems: [{ repo: 'Owner/Repo', problem: 'invalid config' }] } },
  { key: 'item-source:owner/repo', failed: { itemSourceProblems: [{ repo: 'owner/repo', problem: 'no source' }] }, changed: { itemSourceProblems: [{ repo: 'Owner/Repo', problem: 'source unavailable' }] } },
];

test.each(conditions)('$key stays closed through refreshes and changed details, then shows after clearing and recurring', async ({ key, failed, changed }) => {
  await mountPage({ ...healthy, ...failed });
  expect(warning(key)).not.toBeNull();
  await closeWarning(key);
  expect(warning(key)).toBeNull();
  await push({ ...healthy, ...failed });
  await push({ ...healthy, ...changed });
  expect(warning(key)).toBeNull();
  await push(healthy);
  await push({ ...healthy, ...changed });
  expect(warning(key)).not.toBeNull();
});

test('closing a focused warning on the T3 Code missing screen returns focus to Settings', async () => {
  await mountPage({ ...healthy, tools: toolChecks({ t3: { result: 'missing' }, gh: { result: 'missing', fix: 'brew install gh' } }) });
  expect($('.tool-missing')).not.toBeNull();
  await settle(() => warning('gh')!.querySelector<HTMLElement>('.dismiss')!.focus());
  await closeWarning('gh');
  expect(warning('gh')).toBeNull();
  expect(document.activeElement).toBe($('.open-settings'));
});

test.each(['item', 'settings'])('closing a focused warning keeps focus in the open %s dialog', async (kind) => {
  await mountPage({ ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
  // Exercise the notification's focus fallback without the modal trap redirecting focus before close.
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('data-state', 'open');
  if (kind === 'item') dialog.setAttribute('data-item-dialog', '');
  const close = document.createElement('button');
  close.setAttribute('data-slot', 'modal-close');
  close.textContent = 'Close';
  dialog.append(close);
  document.body.append(dialog);
  await settle(() => warning('gh')!.querySelector<HTMLElement>('.dismiss')!.focus());
  await closeWarning('gh');
  expect(dialog.contains(document.activeElement)).toBe(true);
});
