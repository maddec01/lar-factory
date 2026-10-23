// Page test setup: mounts the page's entry (src/main.tsx) on the page the server sends, in a DOM,
// with the network stubbed and the clock fixed. Copy a page test for new ones.

import { act } from 'react';
import { afterEach, beforeEach, vi } from 'vite-plus/test';
import { renderPage } from '../../src/page.ts';
import type { BoardData } from '../../src/model.ts';
import template from '../../index.html?raw';
import sampleJson from '../sample.json' with { type: 'json' };

export const sample = sampleJson as unknown as BoardData;
/** The page's clock: twenty minutes after the sample was read. */
export const NOW = Date.parse('2026-10-21T10:00:00Z');

/** The page's event stream, which a test opens, pushes data on or drops. */
export class FakeEventSource extends EventTarget {
  static readonly CLOSED = 2;
  static current: FakeEventSource | null = null;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    super();
    FakeEventSource.current = this;
  }
  close(): void {}
}

export const stream = () => FakeEventSource.current!;
export const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(sample)));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  FakeEventSource.current = null;
  fetchMock.mockClear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no layout: scrolling does nothing, and nothing prefers reduced motion.
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('scrollBy', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  Element.prototype.scrollIntoView = vi.fn();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Serves the page with `data` at `hash`, then runs its entry until the first paint. */
export async function mountPage(data: BoardData = sample, hash = ''): Promise<void> {
  history.replaceState(null, '', `/${hash}`);
  const html = renderPage(template, data);
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
  await act(async () => {
    await import('../../src/main.tsx');
  });
}

/** Runs `fn`, then lets React and the router finish rendering. */
export async function settle(fn: () => unknown = () => {}): Promise<void> {
  await act(async () => {
    await fn();
  });
}

export const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
