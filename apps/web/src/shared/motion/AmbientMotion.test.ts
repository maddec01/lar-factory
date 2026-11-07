import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';

import { ambientMotion } from './AmbientMotion';

let notify: IntersectionObserverCallback;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
const cleanups: (() => void)[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
        'IntersectionObserver',
        class {
            constructor(callback: IntersectionObserverCallback) {
                notify = callback;
            }
            observe = observe;
            unobserve = unobserve;
            disconnect = disconnect;
        },
    );
});

afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function indicator() {
    const element = document.createElement('span');

    cleanups.push(ambientMotion(element)!);

    return element;
}

const intersect = (target: Element, isIntersecting: boolean) =>
    notify([{ target, isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
const state = (element: Element) => element.getAttribute('data-ambient-motion');

test('an indicator runs only after entering its viewport, and pauses when scrolled out', () => {
    const element = indicator();

    expect(state(element)).toBe('paused');
    intersect(element, true);
    expect(state(element)).toBe('running');
    intersect(element, false);
    expect(state(element)).toBe('paused');
});

test('hiding the window pauses all indicators; showing it resumes only those in view', () => {
    const visible = indicator();
    const outside = indicator();

    intersect(visible, true);
    intersect(outside, false);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    document.dispatchEvent(new Event('visibilitychange'));
    expect([state(visible), state(outside)]).toEqual(['paused', 'paused']);
    // A resize/intersection notification while hidden must not restart the compositor.
    intersect(visible, true);
    expect(state(visible)).toBe('paused');
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect([state(visible), state(outside)]).toEqual(['running', 'paused']);
});

test('detaching and reattaching refs leaves no old observer, listener or paused attribute', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    const element = indicator();
    const other = indicator();

    cleanups.shift()!();
    expect(state(element)).toBeNull();
    expect(unobserve).toHaveBeenCalledWith(element);
    expect(disconnect).not.toHaveBeenCalled();
    intersect(element, true);
    expect(state(element), 'a queued entry for a detached ref is ignored').toBeNull();
    cleanups.shift()!();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    cleanups.push(ambientMotion(element)!);
    intersect(element, true);
    expect(state(element)).toBe('running');
    expect(state(other)).toBeNull();
});

test('without intersection support, indicators still pause and resume with window visibility', () => {
    vi.stubGlobal('IntersectionObserver', undefined);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const element = indicator();

    expect(state(element)).toBe('paused');
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(state(element)).toBe('running');
});
