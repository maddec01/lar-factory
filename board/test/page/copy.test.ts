// The Copy button: it copies its text, says Copied for a moment, and screen readers hear it.

import { Fragment, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { $, settle } from './support.ts';
import { CopyButton, CopyStatus } from '../../src/app/CopyButton.tsx';

async function mount(): Promise<HTMLButtonElement> {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => createRoot($('#root')!).render(
    createElement(Fragment, null, createElement(CopyButton, { text: 'bash update.sh', label: 'Copy board update command' }), createElement(CopyStatus)),
  ));
  return $<HTMLButtonElement>('button')!;
}

test('Copy copies its text, says Copied, and announces it in the copy-status live region', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const button = await mount();
  const status = $('#copy-status')!;
  expect([status.getAttribute('role'), status.getAttribute('aria-live'), status.className]).toEqual(['status', 'polite', 'sr-only']);
  expect([button.textContent, button.className, button.getAttribute('aria-label')]).toEqual(['Copy', 'copy', 'Copy board update command']);

  await settle(() => button.click());
  expect(writeText).toHaveBeenCalledWith('bash update.sh');
  expect(button.textContent).toBe('Copied');
  await settle(() => vi.advanceTimersByTime(50));
  expect(status.textContent).toBe('Copied');
  await settle(() => vi.advanceTimersByTime(1500));
  expect(button.textContent).toBe('Copy');
});

test('a second copy is announced again', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } });
  const button = await mount();
  await settle(() => button.click());
  await settle(() => vi.advanceTimersByTime(100));
  await settle(() => button.click());
  expect($('#copy-status')!.textContent, 'cleared, so the same words are read again').toBe('');
  await settle(() => vi.advanceTimersByTime(50));
  expect($('#copy-status')!.textContent).toBe('Copied');
});

test('without clipboard access, Copy falls back to a selected textarea', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  let copied = '';
  document.execCommand = vi.fn(() => {
    copied = $<HTMLTextAreaElement>('textarea')!.value;
    return true;
  });
  const button = await mount();
  await settle(() => button.click());
  expect(copied).toBe('bash update.sh');
  expect($('textarea'), 'and removes it').toBeNull();
  expect(button.textContent).toBe('Copied');
});
