import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

import { useClock } from './second-clock.ts';

let root: Root;
let host: HTMLDivElement;
const read = vi.fn((now: number) => Math.floor(now / 1_000));

function Clock() {
    return createElement('span', null, useClock(read));
}

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ now: 0 });
    host = document.createElement('div');
    root = createRoot(host);
});

afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
});

test('subscribers share one clock, do no clock work while hidden, and catch up when shown', async () => {
    await act(async () => root.render(createElement('div', null, createElement(Clock), createElement(Clock))));
    expect(vi.getTimerCount()).toBe(1);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
    read.mockClear();
    await act(async () => vi.advanceTimersByTime(5_000));
    expect(read).not.toHaveBeenCalled();
    expect(host.textContent).toBe('00');
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(host.textContent).toBe('55');
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => root.render(null));
    expect(vi.getTimerCount()).toBe(0);
});

test('a clock mounted while hidden waits until the window is shown', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await act(async () => root.render(createElement(Clock)));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => vi.advanceTimersByTime(7_000));
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(host.textContent).toBe('7');
});
