// Page test: mounts the page's entry (src/main.ts) on the server's first-paint markup in a DOM,
// with the network stubbed, then drives it as a user would. Copy this setup for new page tests.

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { renderPage } from '../../src/page.ts';
import { DEFAULT_UI } from '../../src/ui-state.ts';
import type { BoardData } from '../../src/model.ts';
import template from '../../index.html?raw';
import sampleJson from '../sample.json' with { type: 'json' };

const sample = sampleJson as unknown as BoardData;

/** An event stream that never opens, so the page stays on the data it started with. */
class SilentEventSource extends EventTarget {
  static readonly CLOSED = 2;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close(): void {}
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', SilentEventSource);
  // jsdom has no layout, so scrolling does nothing.
  vi.stubGlobal('scrollTo', () => {});
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(sample))));
  const html = renderPage(template, sample, { now: Date.now(), ui: DEFAULT_UI });
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

test('the entry takes over the server-rendered board and the Flow tab switches the view', async () => {
  await import('../../src/main.ts');
  const flowTab = document.querySelector<HTMLButtonElement>('#tab-flow')!;
  expect(document.querySelector('#panel-flow')!.hasAttribute('hidden')).toBe(true);

  flowTab.click();

  expect(location.hash).toBe('#flow');
  expect(document.querySelector('#tab-flow')!.getAttribute('aria-selected')).toBe('true');
  expect(document.querySelector('#panel-flow')!.hasAttribute('hidden')).toBe(false);
  expect(document.querySelector('#panel-board')!.hasAttribute('hidden')).toBe(true);
});
