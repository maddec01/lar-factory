// The Copy button: without clipboard access it still copies its text.

import { Fragment, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';

import { CopyButton, CopyStatus } from './CopyButton';
import { $, settle } from '@/test/PageTest';

async function mount(): Promise<HTMLButtonElement> {
    document.body.innerHTML = '<div id="root"></div>';
    await act(async () =>
        createRoot($('#root')!).render(
            createElement(
                Fragment,
                null,
                createElement(CopyButton, { text: 'pnpm test', label: 'Copy test command' }),
                createElement(CopyStatus),
            ),
        ),
    );

    return $<HTMLButtonElement>('button')!;
}

test('without clipboard access, Copy falls back to a selected textarea', async () => {
    vi.stubGlobal('navigator', {
        clipboard: {
            writeText: async () => {
                throw new Error('denied');
            },
        },
    });

    let copied = '';

    document.execCommand = vi.fn(() => {
        copied = $<HTMLTextAreaElement>('textarea')!.value;

        return true;
    });

    const button = await mount();

    await settle(() => button.click());
    expect(copied).toBe('pnpm test');
    expect($('textarea'), 'and removes it').toBeNull();
    expect(button.textContent).toBe('Copied');
});
