// The design system (@lar-works/design-system) renders in the page with its ninna-ui dependencies.

import { Button, Modal } from '@lar-works/design-system';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';

test("The design system's Modal opens a titled dialog with its close button and content", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

    const onClose = vi.fn();
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);

    await act(async () =>
        root.render(
            createElement(Modal, {
                onClose,
                // oxlint-disable-next-line react/no-children-prop -- required by the props type, which createElement's third argument can't fill
                children: createElement(Modal.Content, {
                    title: 'Edit settings',
                    // oxlint-disable-next-line react/no-children-prop -- required by the props type, as above
                    children: createElement(Button, null, 'Save'),
                }),
            }),
        ),
    );

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;

    expect(dialog.getAttribute('data-slot')).toBe('modal-content');
    expect(dialog.querySelector('h2')?.textContent).toBe('Edit settings');
    expect(
        [...dialog.querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label')),
    ).toEqual(['Close', 'Save']);

    // The design system's board.css sizes the close button by this slot.
    expect(dialog.querySelector('button[aria-label="Close"]')?.getAttribute('data-slot')).toBe('modal-close');
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
});
