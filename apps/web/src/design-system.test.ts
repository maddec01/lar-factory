// The design system (@lar-works/design-system) renders in the page with its ninna-ui dependencies.

import { FormSelect } from '@lar-factory/ui/form-select';
import { Button, Modal } from '@lar-works/design-system';
import { act, createElement, useState, type FormEvent } from 'react';
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

    // button-kinds.css sizes the close button by this slot.
    expect(dialog.querySelector('button[aria-label="Close"]')?.getAttribute('data-slot')).toBe('modal-close');
    await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(onClose).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    host.remove();
});

test('a FormSelect gives its form an empty value for None, the picked value after a pick, and an input event by then', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    );

    const heard: (string | null)[] = [];

    function Owner() {
        const [value, setValue] = useState('');

        return createElement(
            'form',
            {
                onInput: (event: FormEvent<HTMLFormElement>) =>
                    heard.push(new FormData(event.currentTarget).get('who') as string | null),
            },
            createElement(FormSelect, {
                id: 'who',
                name: 'who',
                'aria-label': 'Who',
                value,
                onChange: setValue,
                none: 'None',
                choices: [{ value: 'a', name: 'Ada' }],
            }),
        );
    }

    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);

    await act(async () => root.render(createElement(Owner)));

    const form = host.querySelector('form')!;
    const trigger = form.querySelector<HTMLElement>('#who')!;

    expect(new FormData(form).get('who')).toBe('');
    expect(trigger.textContent).toBe('None');

    await act(async () =>
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })),
    );
    await act(async () =>
        [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === 'Ada')!.click(),
    );
    expect(heard).toEqual(['a']);
    expect(trigger.textContent).toBe('Ada');

    await act(async () =>
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })),
    );
    await act(async () =>
        [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === 'None')!.click(),
    );
    expect(heard).toEqual(['a', '']);
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
});
