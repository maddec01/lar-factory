// The item dialog's "Load older comments": it shows when older comments exist, appends the next page in the details' order,
// hides at the end, keeps the comments already shown when a load fails and lets the button retry, keeps the pages
// loaded while the dialog reopens on an unchanged item, and starts over at the latest comments once it changed.

import type { ItemComment } from '@lar-factory/shared';
import sampleDetailsJson from '@lar-factory/shared/test/sample-details.json' with { type: 'json' };
import { expect, test } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, push, sample, settle, text } from '@/test/PageTest';

/** The sample's older comments of Owner accounts, newest first: 14, so a page of 10 and a page of 4. */
const OLDER = (sampleDetailsJson as unknown as { $older: Record<string, ItemComment[]> }).$older['I_sample13']!;

const dialog = () => $('[data-item-dialog]')!;
const authors = () => $$('[data-comments] li').map((li) => text(li.querySelector('[data-comment-author]')));
const bodies = () => $$('[data-comments] li [data-slot="rich-text"]').map(text);
const loadMore = () =>
    [...dialog().querySelectorAll<HTMLButtonElement>('[data-comments] button')].find((b) =>
        /Load older comments/.test(text(b)),
    );
const errorText = () => text(dialog().querySelector('[data-comments] [role="alert"]'));
/** The older-comment reads the page made, as the parameters each carried. */
const pageReads = () =>
    (fetchMock.mock.calls as unknown as [string][])
        .map(([url]) => url)
        .filter((url) => url.startsWith('/api/item-comments'))
        .map((url) => Object.fromEntries(new URL(url, 'http://board').searchParams));

async function openItem(itemId: string): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(itemId));
}

async function closeItem(): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().close());
}

/** The board answering older-comment reads from `OLDER` 10 at a time by cursor; `fail` makes the next reads fail. */
function serveOlder(): { fail: (count: number) => void; hold: () => () => Promise<void> } {
    let failing = 0;
    let holding: Promise<void> | null = null;
    let release = () => {};
    const original = fetchMock.getMockImplementation()!;

    fetchMock.mockImplementation(async (url: string) => {
        if (!url.startsWith('/api/item-comments')) return original(url);

        await holding;

        if (failing > 0) {
            failing--;

            return new Response(JSON.stringify({ error: 'GitHub is rate limiting the board.' }), { status: 502 });
        }

        const from = Number(new URL(url, 'http://board').searchParams.get('before'));

        return new Response(
            JSON.stringify({
                page: {
                    comments: OLDER.slice(from, from + 10),
                    olderCursor: from + 10 < OLDER.length ? String(from + 10) : null,
                },
            }),
        );
    });

    return {
        fail: (count) => {
            failing = count;
        },
        hold: () => {
            holding = new Promise((resolve) => {
                release = resolve;
            });

            return () => settle(release);
        },
    };
}

test('an unresolved empty discussion offers older comments and only claims no comments after reaching the end', async () => {
    const original = fetchMock.getMockImplementation()!;

    fetchMock.mockImplementation(async (url: string) => {
        if (
            url.startsWith('/api/item-details') &&
            new URL(url, 'http://board').searchParams.get('itemId') === 'I_sample13'
        ) {
            const response = await original(url);
            const body = await response.json();

            body.details.comments = [];
            body.details.hasOlderComments = true;
            body.details.olderCursor = 'unknown';

            return new Response(JSON.stringify(body));
        }

        if (url.startsWith('/api/item-comments'))
            return new Response(JSON.stringify({ page: { comments: [], olderCursor: null } }));

        return original(url);
    });
    await mountPage();
    await openItem('I_sample13');
    expect(text($('[data-comments]'))).toBe('CommentsLoad older comments');
    expect(authors()).toHaveLength(0);
    await settle(() => loadMore()!.click());
    // With no comments left to load, the dialog drops the Comments section rather than saying there are none.
    expect($('[data-comments]')).toBeNull();
    expect(loadMore()).toBeUndefined();
});

test("Load older comments reads the page before the details' cursor and appends it in order, then the last page hides the button", async () => {
    const server = serveOlder();

    await mountPage();
    await openItem('I_sample13');

    const release = server.hold();

    await settle(() => loadMore()!.click());
    expect(pageReads()).toEqual([{ itemId: 'I_sample13', before: '0' }]);
    expect(loadMore()!.disabled, 'disabled while it loads').toBe(true);
    await release();
    expect(bodies().slice(3)).toEqual(OLDER.slice(0, 10).map((c) => c.body));
    expect(authors()).toHaveLength(13);
    expect(bodies().slice(0, 3)[0]).toContain('Moving this to');
    expect(text($('[data-comments] h2'))).toBe('Comments · 13');
    expect(loadMore()!.disabled).toBe(false);

    await settle(() => loadMore()!.click());
    expect(pageReads().at(-1)).toEqual({ itemId: 'I_sample13', before: '10' });
    expect(bodies().slice(13)).toEqual(OLDER.slice(10).map((c) => c.body));
    expect(authors()).toHaveLength(17);
    expect(loadMore(), 'no older comments are left').toBeUndefined();
});

test('a failed load shows its error next to the button, keeps the comments shown and lets the button retry', async () => {
    const server = serveOlder();

    await mountPage();
    await openItem('I_sample13');
    server.fail(1);
    await settle(() => loadMore()!.click());
    expect(errorText()).toBe('Couldn’t load older commentsGitHub is rate limiting the board.Try again');
    expect(authors()).toHaveLength(3);
    expect(loadMore()!.disabled).toBe(false);

    await settle(() => loadMore()!.click());
    expect(pageReads().map((r) => r.before)).toEqual(['0', '0']);
    expect(authors()).toHaveLength(13);
    expect(errorText(), 'the error clears once a load works').toBe('');
});

test('reopening an unchanged item shows the older comments already loaded and goes on from the next page', async () => {
    serveOlder();
    await mountPage();
    await openItem('I_sample13');
    await settle(() => loadMore()!.click());
    expect(authors()).toHaveLength(13);
    await closeItem();
    await openItem('I_sample13');
    expect(authors()).toHaveLength(13);
    await settle(() => loadMore()!.click());
    expect(
        pageReads().map((r) => r.before),
        'the second older page, not the first again',
    ).toEqual(['0', '10']);
    expect(authors()).toHaveLength(17);
});

test('reopening an item whose updatedAt changed starts again at the latest comments', async () => {
    serveOlder();
    await mountPage();
    await openItem('I_sample13');
    await settle(() => loadMore()!.click());
    expect(authors()).toHaveLength(13);
    await closeItem();
    await push({
        ...sample,
        items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, updatedAt: '2026-10-21T09:45:00Z' } : i)),
    });
    await openItem('I_sample13');
    expect(authors()).toHaveLength(3);
    await settle(() => loadMore()!.click());
    expect(
        pageReads().map((r) => r.before),
        'the first older page again, not the second',
    ).toEqual(['0', '0']);
    expect(authors()).toHaveLength(13);
});

test('a page that lands after the dialog closed and reopened isn’t added to the new comments', async () => {
    const server = serveOlder();

    await mountPage();
    await openItem('I_sample13');

    const release = server.hold();

    await settle(() => loadMore()!.click());
    await closeItem();
    await openItem('I_sample13');
    await release();
    expect(authors()).toHaveLength(3);
});
