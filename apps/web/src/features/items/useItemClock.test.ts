// The shared clock keeps a timer only while something shown can change with the time: an idle item keeps none, a working
// one ticks until its row goes, and an age wakes when the unit it shows changes.

import { itemActivityLine, shortAge, untilShortAgeChanges } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';

import { useItemClock } from './useItemClock';
import { useClock } from '@/shared/time/useClock';
import { sample, settle, text } from '@/test/PageTest';

const item = (id: string) => sample.items.find((each) => each.id === id)!;

function Line({ item }: { item: Item }) {
    return createElement(
        'span',
        null,
        useItemClock(item, (now) => itemActivityLine(item, now)?.state ?? 'none'),
    );
}

function Age({ at }: { at: number }) {
    return createElement(
        'span',
        null,
        useClock(
            (now) => shortAge(now - at),
            (now) => untilShortAgeChanges(at, now),
        ),
    );
}

const mount = async (element: ReturnType<typeof createElement>) => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);

    await settle(() => root.render(element));

    return { host, root };
};

test('a finished item keeps no timer, and a working row ticks until it goes', async () => {
    const rows = await mount(createElement(Line, { item: item('I_sample18') }));

    expect(vi.getTimerCount(), 'an idle board runs no clock').toBe(0);

    await settle(() => rows.root.render(createElement(Line, { item: item('I_sample07') })));
    expect(vi.getTimerCount(), 'a working row follows the second').toBe(1);

    await settle(() => rows.root.unmount());
    expect(vi.getTimerCount(), 'the clock stops with nothing left to show').toBe(0);
});

test('an age wakes the clock only when the unit it shows changes', async () => {
    const { host, root } = await mount(createElement(Age, { at: Date.now() - 59_000 }));

    expect(text(host)).toBe('59s');
    await settle(() => vi.advanceTimersByTime(1_000));
    expect(text(host)).toBe('1m');

    const at = Date.now() - 60_000;

    await settle(() => vi.advanceTimersToNextTimer());
    expect([text(host), Date.now() - at], 'the next wake is the next minute').toEqual(['2m', 120_000]);

    await settle(() => root.unmount());
});
