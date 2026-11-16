import { expect, test } from 'vite-plus/test';

import { $, fetchMock, mountPage, sample, settle } from '@/test/PageTest';

const observedAt = '2026-10-31T00:00:00Z';

test('reauthorization reports failure and succeeds without exposing credentials', async () => {
    const degraded = { ...sample, t3Availability: { availability: 'renewal-required' as const } };

    await mountPage(degraded);
    fetchMock.mockImplementation(
        async () => new Response(JSON.stringify({ error: 'Couldn’t reauthorize T3.' }), { status: 503 }),
    );

    const button = () =>
        $<HTMLButtonElement>('[data-warning="t3-source:renewal-required"] button[data-slot="button"]')!;

    await settle(() => button().click());
    expect($('[data-warning="t3-source:renewal-required"]')!.textContent).toContain('Couldn’t reauthorize T3.');
    fetchMock.mockImplementation(
        async () =>
            new Response(
                JSON.stringify({
                    error: null,
                    board: { ...sample, t3Availability: { availability: 'available', observedAt } },
                }),
            ),
    );
    await settle(() => button().click());
    expect($('[data-warning^="t3-source:"]')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/t3/reauthorize')).toBe(true);
});
