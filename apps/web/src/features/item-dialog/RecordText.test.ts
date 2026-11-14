import { expect, test } from 'vite-plus/test';

import { $, detailsRead, detailsReply, fetchMock, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

test.each(['map', 'brief'] as const)(
    'the %s preserves Markdown angle-bracket placeholders in item details',
    async (bodyKind) => {
        const item = {
            ...sample.items.find((work) => work.id === 'I_sample13')!,
            kind: bodyKind === 'map' ? ('concept' as const) : ('build' as const),
            recorded: true,
            number: 0,
            threads: [],
        };
        const board = fresh({ ...sample, items: [item] });

        fetchMock.mockImplementation(async (url: string) => {
            if (detailsRead(url) !== item.id) return new Response(JSON.stringify(board));

            const reply = await detailsReply(item.id).json();

            reply.details.record = {
                bodyKind,
                body: '## Destination\nSend <fragment> to <placeholder>. Keep `<code>` literal.',
                context: '',
                buildPhase: null,
                reviewRounds: [],
            };

            return new Response(JSON.stringify(reply));
        });
        await mountPage(board);

        const { useItemDialogStore } = await import('./ItemDialogStore');

        await settle(() => useItemDialogStore.getState().open(item.id));

        const body = $('[data-item-dialog] [data-record-body]');

        expect(text(body)).toContain('Send <fragment> to <placeholder>. Keep <code> literal.');
        expect(text(body?.querySelector('code'))).toBe('<code>');
        expect(body?.querySelector('fragment, placeholder')).toBeNull();
    },
);

// Enable after the coordinator releases/adopts design-system 0.7.4 (lar-web multi-word placeholder fix).
// oxlint-disable-next-line vitest/no-disabled-tests -- Published 0.7.3 still strips multi-word placeholders.
test.skip('the decision Outcome preserves a spaced placeholder beside code and a link', async () => {
    const item = { ...sample.items.find((work) => work.id === 'I_sample13')!, kind: 'decision' as const, threads: [] };
    const board = fresh({ ...sample, items: [item] });

    fetchMock.mockImplementation(async (url: string) => {
        if (detailsRead(url) !== item.id) return new Response(JSON.stringify(board));

        const reply = await detailsReply(item.id).json();

        reply.details.record = {
            bodyKind: 'decision',
            body: 'Method: grill\nChoose the greeting format.',
            answer: 'Accept only #greeting=<percent-encoded JSON>, decode once. Use `<percent-encoded JSON>` and [the contract](https://example.com).',
            context: '',
            buildPhase: null,
            reviewRounds: [],
        };

        return new Response(JSON.stringify(reply));
    });
    await mountPage(board);

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const body = $('[data-item-dialog] [data-record-body]')!;

    expect(text(body)).toContain('Accept only #greeting=<percent-encoded JSON>, decode once.');
    expect(text(body.querySelector('code'))).toBe('<percent-encoded JSON>');
    expect(body.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
});
