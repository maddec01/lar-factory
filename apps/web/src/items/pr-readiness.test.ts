// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import type { Item, LinkedPr } from '@lar-factory/shared';
import { PrReadiness } from './pr-readiness.tsx';
import { useBoardStore } from '../board/board-store.ts';

const pr = { number: 1, state: 'open', isDraft: false, url: 'https://dev.azure.com/o/p/_git/r/pullrequest/1', sourceRevision: 'one' } as LinkedPr;
const item = { id: 'item', azure: {}, status: 'Ready to merge' } as Item;
const success = (revision: string) => new Response(JSON.stringify({ evidence: { available: true, sourceRevision: revision, observedAt: '2026-10-31T00:00:00Z', blockers: [] } }));

test('open reads fresh evidence; changed revisions, races, failed refresh and disconnect withdraw readiness', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useBoardStore.setState({ data: { fetchedAt: 'first' } as never, clientError: null });
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))));
  const host = document.createElement('div');
  const root = createRoot(host);
  const click = async (label: string) => act(async () => { Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label)!.click(); });
  await act(async () => root.render(createElement(PrReadiness, { item, pr })));
  await click('Readiness details');
  expect(pending).toHaveLength(1);
  await act(async () => pending[0]!(success('one')));
  expect(host.textContent).toContain('Ready to merge based on this observation.');
  await click('Refresh readiness');
  expect(host.textContent).not.toContain('Ready to merge based on this observation.');
  await act(async () => root.render(createElement(PrReadiness, { item, pr: { ...pr, sourceRevision: 'two' } })));
  await act(async () => pending[1]!(success('one')));
  expect(host.textContent).not.toContain('Ready to merge based on this observation.');
  await act(async () => pending[2]!(success('two')));
  expect(host.textContent).toContain('Ready to merge based on this observation.');
  await click('Refresh readiness');
  await act(async () => pending[3]!(new Response('', { status: 503 })));
  expect(host.textContent).toContain('Azure evidence is unavailable.');
  await click('Refresh readiness');
  await act(async () => useBoardStore.setState({ clientError: 'disconnected' }));
  await act(async () => pending[4]!(success('two')));
  expect(host.textContent).toContain('Readiness unavailable: disconnected.');
  expect(host.textContent).not.toContain('Ready to merge based on this observation.');
  expect(item.status).toBe('Ready to merge');
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

test.each([
  { available: true, sourceRevision: 'one', observedAt: '2026-10-31T00:00:00Z', blockers: ['policy:required:running', 'reviewer:required:-10'] },
  { available: false, reason: 'Azure policies unavailable' },
])('shows blockers and unavailable evidence without recommending readiness', async (evidence) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useBoardStore.setState({ data: { fetchedAt: 'first' } as never, clientError: null });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ evidence }))));
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(PrReadiness, { item, pr })));
  await act(async () => host.querySelector('button')!.click());
  expect(host.textContent).not.toContain('Ready to merge based on this observation.');
  if (evidence.available) {
    expect(host.textContent).toContain('Required policy required: running. Check the policy in Azure.');
    expect(host.textContent).toContain('Reviewer required: rejected the pull request. Check reviewer requirements in Azure.');
    expect(host.textContent).toContain('2026-10-31T00:00:00Z');
  } else expect(host.textContent).toContain('Azure policies unavailable');
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

test('unrelated board refreshes neither restart an evidence read nor withdraw its result', async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useBoardStore.setState({ data: { fetchedAt: 'first' } as never, clientError: null });
  const pending: ((response: Response) => void)[] = [];
  const fetch = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)));
  vi.stubGlobal('fetch', fetch);
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement(PrReadiness, { item, pr })));
  await act(async () => host.querySelector('button')!.click());
  for (const fetchedAt of ['second', 'third', 'fourth']) {
    await act(async () => {
      useBoardStore.setState({ data: { fetchedAt } as never });
      root.render(createElement(PrReadiness, { item: { ...item }, pr: { ...pr } }));
    });
  }
  expect(fetch).toHaveBeenCalledTimes(1);
  await act(async () => pending[0]!(success('one')));
  expect(host.textContent).toContain('Ready to merge based on this observation.');
  await act(async () => useBoardStore.setState({ data: { fetchedAt: 'fifth' } as never }));
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Ready to merge based on this observation.');
  await act(async () => root.render(createElement(PrReadiness, { item, pr: { ...pr, checks: { passed: 0, failed: 0, running: 1, total: 1, since: 'now' } } })));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain('Refreshing current revision. Previous evidence is stale.');
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});
