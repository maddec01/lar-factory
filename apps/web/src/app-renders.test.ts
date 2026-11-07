// What the page's clock costs the board under the title bar: a tick that changes nothing there renders no status glyph,
// while ages and whatever a stale read changes still move, and a push with new data still renders. The glyphs are
// counted through their module. The title bar's counters read the clock for their ages and Shipped, so they stay out.

import type { BoardData, Item, Status } from '@lar-factory/shared';
import type { ReactNode } from 'react';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, NOW, fresh, mountPage, moved, push, sample, settle, text } from '../test/support.ts';

let glyphRenders = 0;

vi.mock('./title-bar/counters.tsx', () => ({ Counters: () => null }));

const HOUR = 3_600_000;
const FRESH = new Date(NOW).toISOString();
const running = (id: string, status: Status, extra: object = {}): Item =>
    ({
        ...sample.items[0],
        id,
        number: null,
        status,
        paused: false,
        archived: false,
        needsYou: null,
        updatedAt: FRESH,
        threads: [{ id: `thread-${id}`, purpose: 'build', state: 'working', currentRunning: true, ...extra }],
    }) as unknown as Item;
const queued = {
    ...sample.items[0],
    id: 'I_queued',
    number: null,
    status: 'Queued',
    needsYou: null,
    threads: [],
    updatedAt: FRESH,
} as unknown as Item;
const awaiting = {
    ...sample.items[0],
    id: 'I_verify',
    number: null,
    status: 'Verify',
    needsYou: null,
    threads: [],
    updatedAt: FRESH,
} as unknown as Item;

/** The live board read at NOW, which goes stale after `3 * refreshSeconds`. */
const boardOf = (items: Item[], refreshSeconds: number) => ({ ...fresh(), items, refreshSeconds });

/** Mounts the real page with `data`, and counts the glyph renders after its first paint. The module is mocked here, not
 *  hoisted, as a hoisted mock would keep the glyphs on the store of the page that support.ts loads first. */
async function mounted(data: BoardData) {
    vi.doMock('./items/status-glyph.tsx', async (original) => {
        const real = await original<typeof import('./items/status-glyph.tsx')>();
        const counted =
            <P extends object>(Glyph: (props: P) => ReactNode) =>
            (props: P) => {
                glyphRenders += 1;

                return Glyph(props);
            };

        return { ...real, StatusGlyph: counted(real.StatusGlyph), ItemStatusGlyph: counted(real.ItemStatusGlyph) };
    });
    await mountPage(data);

    const { useBoardStore } = await import('./board/board-store.ts');

    glyphRenders = 0;

    return {
        tickAt: (ms: number) =>
            settle(() => {
                vi.setSystemTime(ms);
                useBoardStore.getState().tick();
            }),
    };
}

test('a tick that changes nothing renders no glyph, and the ages on the desk and in the Queue still move', async () => {
    const { tickAt } = await mounted(boardOf([running('I_build', 'In progress'), queued, awaiting], 100_000));
    const deskAge = () => text($('.desk-card .desk-meta'));

    expect(text($('.queue-age'))).toBe('0s ago');
    expect(deskAge()).toContain('0s ago');
    expect($('.status-spin'), 'the running row spins').not.toBeNull();

    await tickAt(NOW + 2 * HOUR);
    expect(glyphRenders).toBe(0);
    expect(text($('.queue-age'))).toBe('2h ago');
    expect(deskAge()).toContain('2h ago');
});

test("the tick that makes the read stale stops the spinner, keeps T3's activity and puts work at Verify back on the desk", async () => {
    const titles = {
        state: 'running',
        updated: FRESH,
        activity: {
            available: true,
            readAt: new Date(NOW + 180_001).toISOString(),
            action: 'Run the tests',
            actionAt: FRESH,
            toolRunning: true,
            agents: [],
        },
    };
    const { tickAt } = await mounted(
        boardOf([running('I_build', 'In progress', titles), running('I_verify', 'Verify')], 60),
    );
    const onDesk = () => $$('.desk-card').map((card) => card.getAttribute('data-item'));

    expect($('.status-spin')).not.toBeNull();
    expect(text($('[data-activity="working"] [data-action]'))).toBe('Run the tests');
    expect(onDesk()).toEqual([]);

    await tickAt(NOW + 180_001);
    expect(glyphRenders).toBeGreaterThan(0);
    expect($('.status-spin')).toBeNull();
    expect(text($('[data-activity="working"] [data-action]')), 'a stale provider read says nothing of T3').toBe(
        'Run the tests',
    );
    expect(onDesk()).toEqual(['I_verify']);
});

test('a push that changes the data renders the glyphs and shows the change', async () => {
    const data = boardOf([running('I_build', 'In progress'), queued], 100_000);

    await mounted(data);
    expect($('[data-item="I_build"] .status-spin')).not.toBeNull();
    await push(moved('I_build', 'Review', data));
    expect(glyphRenders).toBeGreaterThan(0);
    expect($('[data-item="I_build"] .status-spin')).toBeNull();
});
