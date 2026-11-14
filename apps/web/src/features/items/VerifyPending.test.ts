import type { Item } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, fetchMock, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

const item: Item = {
    ...sample.items.find((work) => work.id === 'I_sample16')!,
    threads: [],
    verification: { required: true, head: null, latest: null, resume: null },
};
const board = fresh({ ...sample, items: [item] });
const open = async () => {
    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(item.id));
};
const panel = () => $('[data-verification]')!;
const button = (label: string) => [...panel().querySelectorAll('button')].find((el) => text(el) === label)!;

test('a pending Verify head read stays loading, retries and enables results without a manual Re-read', async () => {
    let reads = 0;
    let ready = false;

    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/inspect-verification') {
            reads++;

            return !ready
                ? new Response(JSON.stringify({ error: 'A Verify action is pending.' }), { status: 409 })
                : new Response(
                      JSON.stringify({
                          error: null,
                          verification: {
                              head: 'a'.repeat(40),
                              pr: `${item.repo}#8`,
                              revision: 5,
                              testSteps: 'Press Say hello.',
                              by: 'Pedro',
                          },
                      }),
                  );
        }

        return new Response(JSON.stringify(board));
    });
    await mountPage(board);
    await open();
    expect(text(panel())).toContain('Reading PR Test steps');
    expect(text(panel())).not.toContain('No Test steps');
    expect(button('Pass').disabled).toBe(true);

    const before = reads;

    ready = true;
    await settle(() => vi.advanceTimersByTime(500));
    expect(reads).toBeGreaterThan(before);
    expect(text(panel())).toContain('Press Say hello.');
    expect(button('Pass').disabled).toBe(false);
    expect(button('Fail').disabled).toBe(false);
});

test('a failed Verify read describes unread instructions instead of claiming the PR has none', async () => {
    fetchMock.mockImplementation(
        async (url: string) =>
            new Response(
                JSON.stringify(url === '/api/inspect-verification' ? { error: 'Provider unavailable.' } : board),
            ),
    );
    await mountPage(board);
    await open();
    expect(text(panel())).not.toContain('No Test steps');
    expect(text(panel())).toContain('Test steps could not be read');
    expect(button('Pass').disabled).toBe(true);
    expect(button('Re-read PR head').disabled).toBe(false);
});
