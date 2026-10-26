// Page test setup: mounts the page's entry (src/main.tsx) on the page the server sends, in a DOM,
// with the network stubbed and the clock fixed. Copy a page test for new ones.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, vi } from 'vite-plus/test';
import { pageWithData } from '@lar-factory/shared';
import type { BoardData, BoardAppBridge, Status, ToolChecks, UpdateState } from '@lar-factory/shared';
import template from '../index.html?raw';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };

export const sample = sampleJson as unknown as BoardData;

/** Every command check passing, with the ones given in its place. */
export const toolChecks = (checks: Partial<ToolChecks> = {}): ToolChecks => ({
  gh: { result: 'ok' }, t3: { result: 'ok' }, git: { result: 'ok' }, jq: { result: 'ok' }, curl: { result: 'ok' }, ...checks,
});
/** The page's clock: twenty minutes after the sample was read. */
export const NOW = Date.parse('2026-10-21T10:00:00Z');

/** The page's event stream, which a test opens, pushes data on or drops. */
class FakeEventSource extends EventTarget {
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

// Loads the page's modules before a file's first test, so that test doesn't spend its timeout on the app's first load
// while the root `pnpm test` runs every package's workers at once.
beforeAll(async () => {
  document.documentElement.innerHTML = new DOMParser().parseFromString(pageWithData(template, sample), 'text/html').documentElement.innerHTML;
  await import('../src/app.tsx');
  vi.resetModules();
});

/** The window and document listeners the test's page added. A page stays mounted after its test (its entry never
 *  unmounts), so without their removal every earlier test's page also answers each key a later test presses. */
const pageListeners: [EventTarget, string, EventListenerOrEventListenerObject | null, boolean | EventListenerOptions | undefined][] = [];

beforeEach(() => {
  for (const target of new Set<EventTarget>([globalThis, window, document])) {
    const add = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
      pageListeners.push([target, type, listener, options]);
      add(type, listener, options);
    });
  }
  vi.useFakeTimers({ now: NOW });
  FakeEventSource.current = null;
  fetchMock.mockClear();
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no layout: scrolling does nothing, and nothing prefers reduced motion.
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('scrollBy', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  Element.prototype.scrollIntoView = vi.fn();
  // T3's SidebarProvider writes a cookie the board never reads; jsdom has no Cookie Store API.
  vi.stubGlobal('cookieStore', { set: vi.fn(async () => {}) });
  history.replaceState(null, '', '/');
});

afterEach(() => {
  for (const [target, type, listener, options] of pageListeners.splice(0)) target.removeEventListener(type, listener, options);
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(sample)));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

/** Serves the page with `data` at `hash`, then runs its entry until the first paint. */
export async function mountPage(data: BoardData = sample, hash = ''): Promise<void> {
  history.replaceState(null, '', `/${hash}`);
  const html = pageWithData(template, data);
  document.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
  await act(async () => {
    await import('../src/main.tsx');
  });
}

/** Runs `fn`, then lets React finish rendering. */
export async function settle(fn: () => unknown = () => {}): Promise<void> {
  await act(async () => {
    await fn();
  });
}

export const $ = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.querySelectorAll<T>(selector)];
export const text = (el: Element | null | undefined) => el?.textContent ?? '';
/** A banner's title and description. */
export const bannerText = (el: Element) => ['title', 'description'].map((slot) => text(el.querySelector(`[data-slot="alert-${slot}"]`)));
/** The toast on screen. */
export const toast = () => $('[data-slot="toast-viewport"] [data-toast]');

/** Sends `data` down the page's event stream. */
export const push = (data: BoardData) => settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(data) })));
/** The sample with the item `id` in `status`. */
export const moved = (id: string, status: Status): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === id ? { ...i, status } : i)) });

let answerPost: ((body: object, status?: number) => Promise<void>) | undefined;
/** Makes each POST wait until the test answers it, so the pending state can be seen; a board read gets `board`. */
export function holdPosts(board: BoardData = sample): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/board') return new Response(JSON.stringify(board));
    return new Promise<Response>((resolve) => {
      answerPost = (body, status = 200) => settle(() => resolve(new Response(JSON.stringify(body), { status })));
    });
  });
}
/** Answers the POST in flight with `body`. */
export const answer = (body: object, status?: number) => answerPost!(body, status);
/** Each request but the board reads, as its path and parsed body. */
export const posted = () => fetchMock.mock.calls.filter(([url]) => url !== '/api/board').map((call) => {
  const [url, init] = call as unknown as [string, RequestInit | undefined];
  return [url, init?.body && JSON.parse(init.body as string)];
});

/** The updater in a `pnpm run dev` app: off, so the update button shows dimmed with the reason. */
export const updatesOff: UpdateState = {
  enabled: false, status: 'disabled', channel: 'latest', currentVersion: '0.0.0', availableVersion: null,
  downloadedVersion: null, releaseNotes: [], omittedReleaseCount: 0, downloadPercent: null, checkedAt: null,
  message: 'Updates work only in the packaged app.', errorContext: null, canRetry: false,
};

/** Puts the app's preload bridge on the page: `parts`, with the rest doing nothing. */
export function stubApp<T extends Partial<BoardAppBridge>>(parts: T): BoardAppBridge & T {
  const unused = () => Promise.reject(new Error('not stubbed'));
  const bridge = {
    platform: 'darwin',
    listProfiles: unused,
    setProfileTick: unused,
    getWindowFullscreenState: () => false,
    onWindowFullscreenStateChange: () => () => {},
    getUpdateState: async () => updatesOff,
    onUpdateState: () => () => {},
    checkForUpdate: unused,
    downloadUpdate: unused,
    installUpdate: unused,
    setUpdateChannel: unused,
    confirmRestart: unused,
    ...parts,
  };
  vi.stubGlobal('boardApp', bridge);
  return bridge;
}

/** Bridge parts for `stubApp` whose window starts in macOS full screen if `on`; `set` enters or leaves it. */
export function fullScreen(on: boolean) {
  const listeners = new Set<(fullscreen: boolean) => void>();
  const bridge: Pick<BoardAppBridge, 'getWindowFullscreenState' | 'onWindowFullscreenStateChange'> = {
    getWindowFullscreenState: () => on,
    onWindowFullscreenStateChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: boolean) => settle(() => {
    on = next;
    listeners.forEach((listener) => listener(next));
  });
  return { bridge, set };
}

/** src/index.css with the feature folders' sheets it imports in their place. */
const src = join(import.meta.dirname, '../src');
const pageCss = () => readFileSync(join(src, 'index.css'), 'utf8')
  .replace(/@import "\.\/(.+?)";/g, (_line, path: string) => readFileSync(join(src, path), 'utf8'));

/** Puts src/index.css on the page. jsdom has no layout but cascades its rules into getComputedStyle; it can't apply
 *  Tailwind's classes, and it drops -webkit-app-region, so this answers that from the stylesheets' text, the page's
 *  and the design system's, and from Tailwind's arbitrary no-drag class. */
export function addStylesheet(): { noDrag: (el: Element) => boolean } {
  const css = pageCss();
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const all = css + readFileSync(join(import.meta.dirname, '../../../packages/ui/src/styles.css'), 'utf8');
  const selectors = [...all.matchAll(/([^{}]+)\{[^}]*-webkit-app-region:\s*no-drag/g)].map((rule) => rule[1]!.replace(/\/\*[^]*?\*\//g, ''));
  return { noDrag: (el) => el.classList.contains('[-webkit-app-region:no-drag]') || selectors.some((selector) => el.matches(selector)) };
}

/** A fake `confirmRestart` for `stubApp`: it records each question and answers `answer`, true for Restart. */
export const answerRestart = (answer: boolean) => vi.fn(async (_message: string) => answer);
