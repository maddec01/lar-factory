import { STATUSES, type BoardData, type Item } from '@lar-factory/shared';
import { createElement, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, expect, test, vi } from 'vite-plus/test';

import { fresh, sample, settle } from '@/test/PageTest';

// The glyphs read the board store, which starts from the page that PageTest.ts serves.
let StatusGlyph: typeof import('./StatusGlyph').StatusGlyph;

beforeAll(async () => {
    ({ StatusGlyph } = await import('./StatusGlyph'));
});

test('status icons stay still without running activity, and Ready has its own arrow', () => {
    for (const status of STATUSES) {
        const html = renderToStaticMarkup(createElement(StatusGlyph, { status }));

        expect(html).not.toMatch(/status-pulse|status-spin/);

        if (status === 'In progress') expect(html).toContain('lucide-circle');

        if (status === 'Ready') expect(html).toContain('lucide-circle-arrow-right');
    }
});

test.each([
    ['In progress', 'lucide-loader-circle', 'status-spin'],
    ['Shaping', 'lucide-circle-dashed', 'status-pulse'],
    ['Review', 'lucide-eye', 'status-pulse'],
    ['Verify', 'lucide-circle-dot', 'status-pulse'],
    ['Ready to merge', 'lucide-git-merge', 'status-pulse'],
] as const)('%s animates its own icon while running', (status, icon, motion) => {
    const html = renderToStaticMarkup(createElement(StatusGlyph, { status, running: true }));

    expect(html).toContain(icon);
    expect(html).toContain(motion);
});

test('In progress spins a box around its icon, so the compositor runs it at any device scale', () => {
    const html = renderToStaticMarkup(createElement(StatusGlyph, { status: 'In progress', running: true }));

    expect(html).toMatch(/^<span class="[^"]*status-spin[^"]*"><svg /);
});

test.each(['List', 'Queued', 'Ready', 'Needs you', 'Done'] as const)(
    '%s stays still even with running activity',
    (status) => {
        expect(renderToStaticMarkup(createElement(StatusGlyph, { status, running: true }))).not.toMatch(
            /status-pulse|status-spin/,
        );
    },
);

/** Renders a running item's glyph over a board read at NOW, and counts the renders after the first. */
async function runningGlyph() {
    const { useBoardStore } = await import('@/services/board/board.hooks');
    const { ItemStatusGlyph } = await import('./StatusGlyph');
    const item = {
        ...sample.items[0],
        status: 'In progress',
        paused: false,
        archived: false,
        needsYou: null,
        threads: [{ purpose: 'build', state: 'working', currentRunning: true }],
    } as unknown as Item;
    const data = { ...fresh(), items: [item], refreshSeconds: 60 };

    await settle(() => useBoardStore.getState().receive(data, 'action'));

    const onRender = vi.fn();

    document.body.replaceChildren();

    const host = document.body.appendChild(document.createElement('div'));

    await settle(() =>
        createRoot(host).render(
            createElement(Profiler, { id: 'glyph', onRender }, createElement(ItemStatusGlyph, { item })),
        ),
    );
    onRender.mockClear();

    return {
        data,
        host,
        onRender,
        tick: () => settle(() => useBoardStore.getState().tick()),
        receive: (next: BoardData) =>
            settle(() => useBoardStore.getState().receive(JSON.parse(JSON.stringify(next)) as BoardData, 'action')),
    };
}

test('a clock tick that changes nothing a glyph shows renders no glyph', async () => {
    const { host, onRender, tick } = await runningGlyph();

    expect(host.querySelector('.status-spin')).not.toBeNull();
    vi.advanceTimersByTime(15_000);
    await tick();
    expect(onRender).not.toHaveBeenCalled();
});

test('a glyph stops animating on the tick that makes its activity unavailable', async () => {
    const { host, tick } = await runningGlyph();

    vi.advanceTimersByTime(180_001);
    await tick();
    expect(host.querySelector('.status-spin')).toBeNull();
});

test('a push whose starts say the same renders no glyph, and a start beginning stills it', async () => {
    const { data, host, onRender, receive } = await runningGlyph();
    const itemId = data.items[0]!.id;
    const startProgress = (phase: 'failed' | 'starting') =>
        ({ [itemId]: { build: { phase, message: 'Refused' } } }) as BoardData['startProgress'];

    await receive({ ...data, startProgress: startProgress('failed') });
    onRender.mockClear();
    await receive({ ...data, startProgress: startProgress('failed') });
    expect(onRender).not.toHaveBeenCalled();
    expect(host.querySelector('.status-spin')).not.toBeNull();
    await receive({ ...data, startProgress: startProgress('starting') });
    expect(host.querySelector('.status-spin')).toBeNull();
});
