// lar-server's design system, copied into @lar-factory/ui, renders in the page with its ninna-ui dependencies.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Modal } from '@lar-factory/ui/design-system/Modal';

test("lar-server's Modal opens a titled dialog with its close button and content", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const onClose = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => root.render(
    createElement(Modal, { onClose, children: createElement(Modal.Content, { title: 'Edit settings', children: createElement(Button, { children: 'Save' }) }) }),
  ));

  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getAttribute('data-slot')).toBe('modal-content');
  expect(dialog.querySelector('h2')?.textContent).toBe('Edit settings');
  expect([...dialog.querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label'))).toEqual(['Close', 'Save']);

  await act(async () => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  host.remove();
});
