// The page shell: first paint, the control room, live data, and what a re-render keeps.

import type { BoardData } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, warningText, fetchMock, fresh, mountPage, sample, settle, stream, text } from '@/test/PageTest';

test('the first paint shows the board data the server put in the page, with no fetch', async () => {
    await mountPage(fresh());
    expect($$('.desk-row')).toHaveLength(7);
    expect(text($('[data-list-button]')), 'the list counts its 20 items').toBe('List20');
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('#board-data')).not.toBeNull();
    expect($('[data-warning="client-error"]')).toBeNull();
});

test('an entered title round-trips through the inline board data without closing its script element', async () => {
    const title = 'Play <queue> & "mix" </script> $& $1';

    await mountPage({ ...fresh(), items: [{ ...sample.items[0]!, title }] });

    const script = $('#board-data')!;

    expect(script.innerHTML).not.toContain('</script>');
    expect((JSON.parse(script.textContent!) as BoardData).items[0]!.title).toBe(title);
    // The item is in the list, which the list modal shows; jsdom has no ResizeObserver, which the modal observes with.
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );
    await settle(() => $<HTMLButtonElement>('[data-list-button]')!.click());
    expect(document.body.textContent).toContain(title);
});

test('data pushed over /api/events replaces the board, and the open stream stops the polling', async () => {
    await mountPage(fresh());
    await settle(() => stream().onopen!());
    await settle(() => vi.advanceTimersByTime(60_000));
    expect(fetchMock).not.toHaveBeenCalled();
    expect($('.refreshed'), 'a live board shows no Refreshed light').toBeNull();

    await settle(() =>
        stream().onmessage!(
            new MessageEvent('message', { data: JSON.stringify({ ...fresh(), items: sample.items.slice(0, 1) }) }),
        ),
    );
    expect(text($('[data-list-button]'))).toBe('List1');
    expect($$('.desk-row')).toHaveLength(0);
});

test('a failed fetch says the server can’t be reached and keeps the last data', async () => {
    await mountPage(fresh());
    fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
    await settle(() => vi.advanceTimersByTime(15_000));
    expect(warningText($('[data-warning="client-error"]')!)).toEqual([
        'Board disconnected — showing last received data',
        'HTTP 502',
    ]);
    expect($$('.desk-row')).toHaveLength(6);

    fetchMock.mockImplementation(async () => new Response(JSON.stringify(fresh())));
    await settle(() => vi.advanceTimersByTime(15_000));
    expect($('[data-warning="client-error"]')).toBeNull();
});
