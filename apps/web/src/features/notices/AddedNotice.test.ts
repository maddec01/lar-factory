import { expect, test } from 'vite-plus/test';

import { $, fetchMock, mountPage, sample, settle } from '@/test/PageTest';

test('Queue holds feedback, coordinates requests and hands focus to View item', async () => {
    await mountPage(sample);

    const { notify } = await import('./Notices');
    const item = sample.items.find((value) => value.status === 'List')!;

    await settle(() => notify({ verb: 'Added', item, to: 'List' }));

    let finish!: (response: Response) => void;

    fetchMock.mockImplementationOnce(
        () =>
            new Promise<Response>((resolve) => {
                finish = resolve;
            }),
    );

    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-toast="notice"] button')).find(
        (value) => value.textContent === 'Queue',
    )!;

    button.focus();
    await settle(() => {
        button.click();
        button.click();
    });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect($('[data-toast="notice"]')?.textContent).toContain('Queuing');
    await settle(() =>
        finish(
            new Response(
                JSON.stringify({
                    error: null,
                    board: {
                        ...sample,
                        items: sample.items.map((value) =>
                            value.id === item.id ? { ...value, status: 'Queued' } : value,
                        ),
                    },
                }),
            ),
        ),
    );
    expect($('[data-toast="notice"]')?.textContent).toContain('to Queued');
    expect(document.activeElement?.textContent).toBe('View item');
});
