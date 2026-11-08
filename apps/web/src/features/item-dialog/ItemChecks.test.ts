import { expect, test } from 'vite-plus/test';

import { $, fetchMock, mountPage, sample, settle, text } from '@/test/PageTest';

test('a failed checks read retries, clears its error while pending and keeps its successful result', async () => {
    const original = fetchMock.getMockImplementation()!;
    let attempts = 0;
    let resolve!: (value: Response) => void;

    fetchMock.mockImplementation(async (url: string) => {
        if (!url.startsWith('/api/item-checks')) return original(url);

        attempts++;

        if (attempts === 1)
            return new Response(JSON.stringify({ error: 'Checks temporarily unavailable' }), { status: 503 });

        return new Promise<Response>((done) => {
            resolve = done;
        });
    });

    const item = sample.items.find((item) => item.number === 142)!;

    await mountPage({
        ...sample,
        items: sample.items.map((entry) => (entry.id === item.id ? { ...entry, kind: 'build' } : entry)),
    });

    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));

    const section = () => $('[data-item-dialog] [data-checks]')!;

    await settle(() => {
        const disclosure = section() as HTMLDetailsElement;

        disclosure.open = true;
        disclosure.dispatchEvent(new Event('toggle'));
    });
    expect(text(section())).toContain('Checks temporarily unavailable');

    const retry = [...section().querySelectorAll('button')].find((button) => text(button) === 'Try again')!;

    await settle(() => retry.click());
    expect(text(section())).not.toContain('Checks temporarily unavailable');
    expect(text(section())).toContain('Loading checks');
    await settle(() => resolve(new Response(JSON.stringify({ checks: { runs: [], reuses: [] } }))));
    expect(text(section())).toContain('No checks are recorded');
    await settle(() => {
        section().dispatchEvent(new Event('toggle'));
    });
    expect(attempts).toBe(2);
});
