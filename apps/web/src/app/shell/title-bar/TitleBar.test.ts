// The board's title bar, in the board app (past its traffic lights) and in a browser (without any): on the left the brand and the
// status strip, the Refreshed time and the counters; beside the actions the board search's field; on the right one
// evenly spaced group: List, Add item, Update while there's an update, and Settings. Above the missing-t3 notice only
// the brand and Settings.

import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { $, $$, NOW, fresh, mountPage, push, sample, settle, text } from '@/test/PageTest';

// jsdom has no ResizeObserver, which the design system's Modal's scroll fade observes with.
beforeEach(() =>
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    ),
);

const titleBar = () => $<HTMLElement>('.title-bar')!;
const field = () => titleBar().querySelector<HTMLButtonElement>('[data-search-field]')!;
const refreshed = () => titleBar().querySelector<HTMLElement>('.refreshed')!;
const ping = () => refreshed().querySelector('[data-ping]');
const readAgo = (ago: number) => ({ ...sample, error: null, fetchedAt: new Date(NOW - ago).toISOString() });
/** The board's health as the Refreshed dot shows it: amber when stale, green when live. */
const health = () => refreshed().getAttribute('data-health');
const isAmber = () => health() === 'stale';
const isGreen = () => health() === 'live';

test('Add item opens the Add item flow, and ⌘N does too', async () => {
    await mountPage();

    const add = titleBar().querySelector<HTMLButtonElement>('.add-item')!;

    expect([text(add), add.getAttribute('aria-keyshortcuts')]).toEqual(['Add item', 'Meta+N']);
    await settle(() => add.click());
    expect($('#add-item-dialog')!.hidden).toBe(false);
});

test('the list modal’s Scope board scopes the title bar too', async () => {
    await mountPage();
    await settle(() => $<HTMLButtonElement>('.title-bar .list-button')!.click());
    await settle(() =>
        $$<HTMLButtonElement>('[data-list-modal] nav button')
            .find((b) => b.querySelector('.name')?.textContent === 'lar-apple')!
            .click(),
    );
    await settle(() => $<HTMLButtonElement>('[data-list-modal] [data-scope-board]')!.click());
    expect(field().getAttribute('aria-description')).toBe('filtered by lar-apple');
});

test('a fresh board has a green dot; stale turns the dot amber and says Stale', async () => {
    await mountPage(fresh());
    expect(isGreen()).toBe(true);
    expect(text(refreshed())).toBe('just now');
    await push(readAgo(4 * 86_400_000));
    expect(text(refreshed())).toBe('Stale · 4d ago');
    expect(isAmber()).toBe(true);
    await push(readAgo(20 * 60_000 + 1));
    expect(text(refreshed()), 'no error, but not read for 3 intervals').toBe('Stale · 20m ago');
});

test('before the first read it says so behind a grey dot, or an amber one if that read failed', async () => {
    await mountPage({ ...sample, fetchedAt: null, error: null });
    expect(text(refreshed())).toBe('Not read yet');
    expect([isAmber(), isGreen()]).toEqual([false, false]);
    await push({ ...sample, fetchedAt: null, error: 'gh api graphql failed' });
    expect(text(refreshed())).toBe('Not read yet');
    expect(isAmber()).toBe(true);
});

test('while some repositories still read, it shows Loading projects behind a grey dot, never Stale, until every read lands', async () => {
    const reading = (waiting: string[]) => ({
        ...fresh(),
        firstRead: { step: 'items' as const, running: [], waiting, settled: false },
    });

    await mountPage(reading(['maddec01/lar-server', 'maddec01/lar-apple']));
    expect(text(refreshed())).toBe('Loading projects');
    expect([isAmber(), isGreen()]).toEqual([false, false]);
    await push(reading(['maddec01/lar-apple']));
    expect(text(refreshed())).toBe('Loading projects');
    await push(fresh());
    expect(text(refreshed())).toBe('just now');
    expect(isGreen()).toBe(true);
});

test('the Refreshed clock stops while the window is hidden and catches up immediately when shown', async () => {
    await mountPage(fresh());

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    await settle(() => document.dispatchEvent(new Event('visibilitychange')));
    await settle(() => vi.advanceTimersByTime(12_000));
    expect(text(refreshed())).toBe('just now');
    hidden.mockReturnValue(false);
    await settle(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(text(refreshed())).toBe('12s ago');
    await settle(() => vi.advanceTimersByTime(1_000));
    expect(text(refreshed())).toBe('13s ago');
});

test('the dot pings once for each newer read, never on page load, in stale or when older data arrives', async () => {
    await mountPage(readAgo(10_000));
    expect(ping(), 'not on page load').toBeNull();
    await settle(() => vi.advanceTimersByTime(5_000));
    expect(ping()).toBeNull();
    await push(fresh());

    const first = ping();

    expect(first).not.toBeNull();
    await push(fresh());
    expect(ping(), 'the same read again doesn’t replay it').toBe(first);
    await settle(() => vi.advanceTimersByTime(2_000));
    await push(readAgo(1_000));
    expect(ping(), 'an older read doesn’t ping').toBe(first);
    await settle(() => vi.advanceTimersByTime(3_000));
    await push({ ...readAgo(-5_000), items: [] });
    expect(ping(), 'a newer read replays it').not.toBe(first);
});
