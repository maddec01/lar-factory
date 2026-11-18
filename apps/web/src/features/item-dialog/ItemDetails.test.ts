// The item dialog's details: the description and comments in its main column, the people, dates, milestone or iteration
// and area in the meta area under its title, and the sub-tickets in its sidebar, with the loading, failed and empty states, one read per open, and a reply for an item no longer open
// ignored.

import type { BoardData } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, detailsReply, detailsRead, fetchMock, mountPage, push, sample, settle, text } from '@/test/PageTest';

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

test('Spec publication offers Retry only after an actual failure', async () => {
    const held = holdReads();

    await mountPage();
    await openItem('I_sample13');

    const details = (await detailsReply('I_sample13').json()).details;
    const spec = { generation: 1, pending: true, error: null, warning: null, outdated: false, held: null };

    await reply(held, 'I_sample13', new Response(JSON.stringify({ details: { ...details, spec } })));
    expect(text(inDialog('[data-spec-sync]'))).toContain('Publishing Spec…');
    expect(text(inDialog('[data-spec-sync]'))).not.toContain('Retry Spec sync');
    await closeItem();
    (await import('@/services/items/items.hooks')).forgetItemDetails('I_sample13');
    await openItem('I_sample13');
    await reply(
        held,
        'I_sample13',
        new Response(JSON.stringify({ details: { ...details, spec: { ...spec, error: 'Write failed' } } })),
    );
    expect(text(inDialog('[data-spec-sync]'))).toContain('Write failed');
    expect(text(inDialog('[data-spec-sync]'))).toContain('Retry Spec sync');
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
    expect(text(description())).toContain('Team accounts');
    expect(text(inDialog('[data-slot="modal-header"] h2'))).toBe('#140 Team accounts');
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

/** The sample with Team accounts updated at `updatedAt`, as the board pushes it after a comment. */
const updatedAt = (iso: string): BoardData => ({
    ...sample,
    items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, updatedAt: iso } : i)),
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
    expect(text(description())).not.toContain('Team accounts');
});

test('a merge refreshes an open item and a later completion announces Done once', async () => {
    await mountPage();
    await openItem('I_sample13');

    const updated = (status: 'Ready to merge' | 'Done', state: 'open' | 'merged'): BoardData => ({
        ...sample,
        items: sample.items.map((i) =>
            i.id === 'I_sample13'
                ? {
                      ...i,
                      status,
                      linkedPrs: [
                          {
                              number: 99,
                              url: 'https://github.com/team/app/pull/99',
                              state,
                              isDraft: false,
                              checks: null,
                              mergeState: 'can merge',
                          },
                      ],
                  }
                : i,
        ),
    });

    await push(updated('Ready to merge', 'open'));

    const before = reads().length;

    await push(updated('Ready to merge', 'merged'));
    expect(reads().length).toBeGreaterThan(before);
    expect(text(document.body)).toContain('Merged: #140');
    await push(updated('Done', 'merged'));
    expect(text(document.body)).toContain('Done: #140');
    await settle(() => document.querySelector<HTMLButtonElement>('[aria-label="Dismiss: Done: #140"]')!.click());
    await push(updated('Done', 'merged'));
    expect(text(document.body)).not.toContain('Done: #140');
});
