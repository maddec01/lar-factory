// The item dialog's details: the description and comments in its main column, the people, dates, milestone or iteration
// and area in the meta area under its title, and the sub-tickets in its sidebar, with the loading, failed and empty states, one read per open, and a reply for an item no longer open
// ignored.

import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, $$, detailsReply, detailsRead, fetchMock, mountPage, push, sample, settle, text } from '@/test/PageTest';

const dialog = () => $('[data-item-dialog]');
const inDialog = <T extends Element = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const description = () => inDialog('[data-description]');
/** The details reads still wanted: StrictMode starts each effect twice in the page and aborts the first read. */
const reads = () =>
    (fetchMock.mock.calls as unknown as [string, RequestInit][])
        .filter(([, init]) => !init.signal?.aborted)
        .map(([url]) => detailsRead(url))
        .filter(Boolean);

async function openItem(itemId: string): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(itemId));
}

async function closeItem(): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().close());
}

/** Holds each details read until the test answers it, keyed by item id; a read of the board still gets the sample. */
function holdReads(): Map<string, (response: Response) => void> {
    const held = new Map<string, (response: Response) => void>();

    fetchMock.mockImplementation(async (url: string) => {
        const itemId = detailsRead(url);

        if (!itemId) return new Response(JSON.stringify(sample));

        return new Promise<Response>((resolve) => held.set(itemId, resolve));
    });

    return held;
}

const reply = (
    held: Map<string, (response: Response) => void>,
    itemId: string,
    response: Response = detailsReply(itemId),
) => settle(() => held.get(itemId)!(response));

test('a failed read shows its error in the modal and the board data stays visible', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await reply(
        held,
        'I_sample13',
        new Response(JSON.stringify({ error: 'Item details aren’t available yet.' }), { status: 501 }),
    );
    expect(text(inDialog('[data-details-error]'))).toBe(
        'Couldn’t load the detailsItem details aren’t available yet.Try again',
    );
    expect(text(inDialog('[data-slot="modal-header"] h2'))).toBe('#140 Owner accounts');
    expect(text(inDialog('[data-slices] p'))).toBe('Slices · 1/3 done');
    expect(inDialog('[aria-busy="true"]')).toBeNull();
});

test('a failed detail read can retry in place and recover without closing the item', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await reply(held, 'I_sample13', new Response(JSON.stringify({ error: 'Temporary outage.' }), { status: 503 }));

    const retry = inDialog<HTMLButtonElement>('[data-details-error] button')!;

    expect(text(retry)).toBe('Try again');
    await settle(() => retry.click());
    expect(retry.getAttribute('aria-busy')).toBe('true');
    await reply(held, 'I_sample13');
    expect(inDialog('[data-details-error]')).toBeNull();
    expect(text(description())).toContain('Owner accounts');
    expect(text(inDialog('[data-slot="modal-header"] h2'))).toBe('#140 Owner accounts');
});

test('pressing Retry again while it reads starts no second read, by click or by keyboard', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await reply(held, 'I_sample13', new Response(JSON.stringify({ error: 'Temporary outage.' }), { status: 503 }));

    const retry = inDialog<HTMLButtonElement>('[data-details-error] button')!;
    const before = reads().length;

    await settle(() => retry.click());
    await settle(() => retry.click());
    await settle(() => retry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await settle(() => retry.click());
    expect(reads().length - before, 'one refresh in flight').toBe(1);
    await reply(held, 'I_sample13');
    expect(inDialog('[data-details-error]')).toBeNull();
    expect(reads().length - before, 'and none after it lands').toBe(1);
});

test('details hide managed and mapped labels, and show linked-work only as a locked note', async () => {
    const labelled = {
        ...sample.items.find((i) => i.id === 'I_sample13')!,
        kind: 'bug' as const,
        labels: ['bug', 'status-ready', 'linked-work', 'urgent', 'type: bug'],
        labelColors: { urgent: '#B60205' },
    };
    const setup = {
        vocabulary: effectiveVocabulary({ bug: { type: null, labels: ['type: bug'] } }).vocabulary,
    } as NonNullable<BoardData['repos'][number]['setup']>;

    await mountPage({
        ...sample,
        repos: sample.repos.map((r) => (r.repo === labelled.repo ? { ...r, setup } : r)),
        items: sample.items.map((i) => (i.id === labelled.id ? labelled : i)),
    });
    await openItem('I_sample13');

    const chips = [...$$<HTMLElement>('[data-item-dialog] [data-labels] [data-label-chip]')];

    expect(chips.map(text)).toEqual(['urgent', 'linked-work']);
    expect(chips[0]!.style.backgroundColor, 'neutral surface').toBe('');
    expect(chips[0]!.querySelector<HTMLElement>('[data-status-dot]')!.style.getPropertyValue('--status-dot')).toBe(
        '#B60205',
    );
    expect(text(inDialog('[data-labels] [data-locked-label]'))).toBe('linked-work');
    expect(inDialog('[data-kind-badge]'), 'the Kind control names the kind instead of a badge').toBeNull();
    expect(text(inDialog('[data-item-summary] [aria-label="Kind"]'))).toBe('Bug');
});

test('one read per open: live board data updates the board fields and leaves the fetched details as fetched', async () => {
    await mountPage();
    await openItem('I_sample13');
    expect(reads()).toEqual(['I_sample13']);

    const before = text(description());

    await push({
        ...sample,
        items: sample.items.map((i) =>
            i.id === 'I_sample13' ? { ...i, labels: ['build', 'urgent'], updatedAt: '2026-10-21T09:30:00Z' } : i,
        ),
    });
    expect(inDialog('[data-labels]')!.textContent).toBe('urgent');
    expect(text(description())).toBe(before);
    expect(reads()).toEqual(['I_sample13']);
});

/** The sample with Owner accounts updated at `updatedAt`, as the board pushes it after a comment. */
const updatedAt = (iso: string): BoardData => ({
    ...sample,
    items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, updatedAt: iso } : i)),
});

test('reopening the dialog on an item whose updatedAt is unchanged shows its details at once, with no read', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await reply(held, 'I_sample13');

    const before = text(description());
    const earlier = fetchMock.mock.calls.length;

    await closeItem();
    await openItem('I_sample13');
    expect(fetchMock.mock.calls.length, 'no read of its own').toBe(earlier);
    expect(inDialog('[aria-busy="true"]'), 'no loading state').toBeNull();
    expect(text(description())).toBe(before);
});

test('reopening the dialog once the item’s updatedAt has changed reads the details again', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await reply(held, 'I_sample13');
    expect(description()).not.toBeNull();

    const earlier = fetchMock.mock.calls.length;

    await closeItem();
    await push(updatedAt('2026-10-21T09:45:00Z'));
    await openItem('I_sample13');
    expect(fetchMock.mock.calls.length, 'a read of its own').toBeGreaterThan(earlier);
    expect(reads(), 'the earlier read ended with the dialog').toEqual(['I_sample13']);
    expect(inDialog('[aria-busy="true"]'), 'loading again, not the earlier details').not.toBeNull();
    expect(description()).toBeNull();
    await reply(held, 'I_sample13');
    expect(description()).not.toBeNull();
});

test('a comment that moves updatedAt while the dialog is open doesn’t read again until it reopens', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await reply(held, 'I_sample13');
    await push(updatedAt('2026-10-21T09:45:00Z'));
    await closeItem();
    await openItem('I_sample13');
    expect(inDialog('[aria-busy="true"]'), 'the details were read at the earlier updatedAt').not.toBeNull();
});

test('a reply for an item that is no longer open is ignored', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');
    await closeItem();
    await openItem('I_sample26');
    await reply(held, 'I_sample26');
    expect(text(description())).toContain('Bumps FFmpeg');
    // The first item's late reply lands on a dialog that moved on.
    await reply(held, 'I_sample13');
    expect(text(inDialog('[data-slot="modal-header"] h2'))).toContain('Bump FFmpeg');
    expect(text(description())).toContain('Bumps FFmpeg');
    expect(text(description())).not.toContain('Owner accounts');
});

test('build checks load once on expansion and retain the empty result on reopen', async () => {
    await mountPage();

    const build = sample.items.find((item) => item.kind === 'build' && item.linkedPrs.length > 0)!;

    await openItem(build.id);

    const calls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/item-checks'));

    expect(calls()).toHaveLength(0);
    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ checks: { workId: build.id, list: [], runs: [], reuses: [] } })),
    );

    const section = inDialog<HTMLDetailsElement>('[data-checks]')!;

    await settle(() => {
        section.open = true;
        section.dispatchEvent(new Event('toggle'));
    });
    expect(calls()).toHaveLength(1);
    expect(text(section)).toContain('No checks are recorded.');
    await settle(() => {
        section.open = false;
        section.dispatchEvent(new Event('toggle'));
    });
    await settle(() => {
        section.open = true;
        section.dispatchEvent(new Event('toggle'));
    });
    expect(calls()).toHaveLength(1);
});
