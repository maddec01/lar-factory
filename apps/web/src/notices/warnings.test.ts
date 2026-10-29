import { expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, fetchMock, mountPage, push, sample, settle, stream, toolChecks, warningText } from '../../test/support.ts';
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
  const entry = warning(key)!;
  expect(entry.dataset.toastColor).toBe('warning');
  expect(entry.querySelector('.dismiss')!.getAttribute('aria-label')).toMatch(/^Dismiss: .+/);
  await settle(() => stream().onopen!());
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(warning(key)).toBe(entry);
  await push({ ...healthy, ...changed });
  expect(warning(key), 'changed details preserve the notification and its age').toBe(entry);
  await push(healthy);
  expect(warning(key)).toBeNull();
  await push({ ...healthy, ...failed });
  await closeWarning(key);
  expect(warning(key)).toBeNull();
  await push({ ...healthy, ...failed });
  await push({ ...healthy, ...changed });
  expect(warning(key)).toBeNull();
  await push(healthy);
  await push({ ...healthy, ...changed });
  expect(warning(key)).not.toBeNull();
});

test.each(['empty', 'T3 Code missing'])('server failures stay closed through changed details on the %s screen and recur after a successful read', async (screen) => {
  const data: BoardData = { ...healthy, error: null, repos: [], items: [], tools: toolChecks(screen === 'empty' ? {} : { t3: { result: 'missing' } }) };
  await mountPage(data);
  expect($(screen === 'empty' ? '[data-empty-state]' : '.tool-missing')).not.toBeNull();
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(warningText(warning('client-error')!)).toEqual(["Can't reach the board server.", 'HTTP 502 Showing the last data this page received.']);
  const entry = warning('client-error');
  fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(warning('client-error')).toBe(entry);
  expect(warningText(entry!)[1]).toContain('HTTP 503');
  await settle(() => entry!.querySelector<HTMLElement>('.dismiss')!.focus());
  await closeWarning('client-error');
  expect(document.activeElement).toBe($(screen === 'empty' ? '.add-item' : '.open-settings'));
  fetchMock.mockImplementation(async () => new Response('', { status: 504 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(warning('client-error')).toBeNull();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(data)));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(warning('client-error')).toBeNull();
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(warning('client-error')).not.toBeNull();
});

test('a successful Recheck restores a closed server warning as well as successful live reads', async () => {
  await mountPage({ ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  await closeWarning('client-error');
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: null, board: healthy })));
  await settle(() => $<HTMLButtonElement>('[data-recheck]')!.click());
  expect(warning('gh')).toBeNull();
  fetchMock.mockImplementation(async () => new Response('', { status: 503 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(warning('client-error')).not.toBeNull();
});

test('dismissal is independent across tools, repositories and warning kinds', async () => {
  const data: BoardData = { ...healthy,
    tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' }, git: { result: 'missing', fix: 'brew install git' } }),
    repositoryConfigProblems: [{ repo: 'owner/one', problem: 'no config' }, { repo: 'owner/two', problem: 'no config' }],
    itemSourceProblems: [{ repo: 'owner/one', problem: 'unavailable' }, { repo: 'owner/two', problem: 'unavailable' }],
  };
  await mountPage(data);
  await closeWarning('gh');
  await closeWarning('repository-config:owner/one');
  await closeWarning('item-source:owner/two');
  const keys = () => $$('[data-warning]').map((entry) => entry.dataset.warning);
  expect(keys()).toEqual(['git', 'repository-config:owner/two', 'item-source:owner/one']);
  await push({ ...data, repositoryConfigProblems: [{ repo: 'Owner/One', problem: 'invalid config' }, data.repositoryConfigProblems![1]!] });
  expect(keys()).toEqual(['git', 'repository-config:owner/two', 'item-source:owner/one']);
  // Clearing another kind and repository leaves each closed condition suppressed.
  await push({ ...data, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }),
    repositoryConfigProblems: [data.repositoryConfigProblems![0]!], itemSourceProblems: [data.itemSourceProblems![1]!] });
  expect(keys()).toEqual([]);
  await push(data);
  expect(keys()).toEqual(['git', 'repository-config:owner/two', 'item-source:owner/one']);
});

test('a closed tool warning stays closed across scope, empty state and T3 Code missing screen changes', async () => {
  const data: BoardData = { ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) };
  await mountPage(data);
  const { useScopeStore } = await import('../board/scope-store.ts');
  await closeWarning('gh');
  await settle(() => useScopeStore.getState().setScope(sample.repos[0]!.repo));
  await push({ ...data, tools: { ...data.tools!, t3: { result: 'missing' } } });
  expect($('.tool-missing')).not.toBeNull();
  expect(warning('gh')).toBeNull();
  await push({ ...data, repos: [], items: [], error: null });
  expect($('[data-empty-state]')).not.toBeNull();
  expect(warning('gh')).toBeNull();
  await push({ ...healthy, repos: [], items: [], error: null });
  await push({ ...data, repos: [], items: [], error: null });
  expect(warning('gh')).not.toBeNull();
});

test('az coverage hides an item-source warning without clearing its dismissal', async () => {
  const data: BoardData = { ...healthy, itemSourceProblems: [{ repo: 'owner/repo', problem: 'logged out', fix: 'az login' }] };
  const covered: BoardData = { ...data, tools: toolChecks({ az: { result: 'logged-out', fix: 'az login' } }) };
  await mountPage(data);
  await closeWarning('item-source:owner/repo');
  await push(covered);
  expect(warning('az')).not.toBeNull();
  expect(warning('item-source:owner/repo')).toBeNull();
  await closeWarning('az');
  await push(data);
  expect(warning('item-source:owner/repo')).toBeNull();
  // A real clearing while covered still restores a later recurrence.
  await push({ ...covered, itemSourceProblems: [] });
  await push(covered);
  expect(warning('item-source:owner/repo')).toBeNull();
  await push(data);
  expect(warning('item-source:owner/repo')).not.toBeNull();
});

test('warning details update in place among toasts without changing age, scrolling or other timers', async () => {
  await mountPage(healthy);
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'success', what: 'Saved', body: 'Saved' }));
  await settle(() => vi.advanceTimersByTime(4_800));
  await push({ ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
  const entry = warning('gh');
  const recheck = entry!.querySelector<HTMLElement>('[data-recheck]')!;
  await settle(() => recheck.focus());
  const id = entry!.dataset.toastId;
  await settle(() => showToast({ slot: 'failure', failed: true, what: 'Failed', body: 'Failed' }));
  const viewport = $('[data-slot="toaster"]')!;
  viewport.scrollTop = 25;
  await push({ ...healthy, tools: toolChecks({ gh: { result: 'logged-out', fix: 'gh auth login' } }) });
  expect(warning('gh')).toBe(entry);
  expect(warning('gh')!.dataset.toastId).toBe(id);
  expect(document.activeElement).toBe(recheck);
  expect(warningText(entry!)[0]).toBe('GitHub CLI is logged out.');
  expect($$('[data-slot="toaster"] [data-slot="toast"]').map((el) => el.dataset.toastColor)).toEqual(['success', 'warning', 'danger']);
  expect(viewport.scrollTop).toBe(25);
  await settle(() => recheck.blur());
  await settle(() => vi.advanceTimersByTime(200));
  expect($('[data-toast="success"]')).toBeNull();
  await push(healthy);
  expect(warning('gh')).toBeNull();
  expect($('[data-toast="failure"]')).not.toBeNull();
  await settle(() => showToast({ slot: 'success', what: 'Saved again', body: 'Saved again' }));
  await push({ ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
  await settle(() => vi.advanceTimersByTime(4_900));
  await push(healthy);
  await settle(() => vi.advanceTimersByTime(100));
  expect($('[data-toast="success"]')).toBeNull();
  expect($('[data-toast="failure"]')).not.toBeNull();
});

test('unchanged warnings make no live-region mutations on refreshes and clock ticks', async () => {
  const data: BoardData = { ...healthy, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) };
  await mountPage(data);
  const entry = warning('gh')!;
  expect(entry.getAttribute('aria-live')).toBe('polite');
  const mutations: MutationRecord[] = [];
  const observer = new MutationObserver((records) => mutations.push(...records));
  observer.observe(entry, { subtree: true, childList: true, characterData: true, attributes: true });
  await settle(() => stream().onopen!());
  for (let i = 0; i < 3; i++) {
    await push(data);
    await settle(() => vi.advanceTimersByTime(15_000));
  }
  observer.disconnect();
  expect(warning('gh')).toBe(entry);
  expect(mutations).toHaveLength(0);
});

test('more warnings and toasts than fit remain in one bounded scrolling viewport', async () => {
  await mountPage(healthy);
  addStylesheet();
  const viewport = $('[data-slot="toaster"]')!;
  Object.defineProperty(viewport, 'scrollHeight', { value: 1_000 });
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'success', what: 'Saved', body: 'Saved' }));
  await push({ ...healthy, repositoryConfigProblems: Array.from({ length: 7 }, (_, index) => ({ repo: `owner/repo${index}`, problem: 'invalid config' })) });
  await settle(() => showToast({ slot: 'failure', failed: true, what: 'Failed', body: 'Failed' }));
  expect($$('[data-slot="toaster"]')).toEqual([viewport]);
  expect($$('[data-slot="toaster"] [data-slot="toast"]')).toHaveLength(9);
  expect($$('[data-slot="toaster"] [data-slot="toast"]').map((el) => el.dataset.toastColor)).toEqual(['success', ...Array<string>(7).fill('warning'), 'danger']);
  expect(viewport.scrollTop).toBe(1_000);
  expect(getComputedStyle(viewport).overflowY).toBe('auto');
  expect(getComputedStyle(viewport).maxHeight).toBe('min(60vh, calc(100dvh - var(--spacing) * 20))');
  expect($$('[data-toast-color="warning"]').every((entry) => getComputedStyle(entry).flexShrink === '0')).toBe(true);
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
