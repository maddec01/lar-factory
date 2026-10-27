// The setup fields and the custom label picker outside the wizard: each shows the values it's given and calls back with
// the user's changes, with no store behind it.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import type { SetupAnswers } from '@lar-factory/shared';
import { $, $$, settle, text } from '../../test/support.ts';
import { CustomLabelPicker, SetupFields, type CustomLabelPicks } from './setup-fields.tsx';

const SETUP: SetupAnswers = { itemSource: 'github-project', projectOwner: 'maddec01', projectNumber: '', show: 'all', showPicked: false, role: '' };

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => createRoot($('#root')!).render(element));
}

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

test("the setup fields show the answers they're given, name Save in their problems and call back with each change", async () => {
  const onAnswer = vi.fn();
  await mount(createElement(SetupFields, { repo: 'maddec01/lar-web', setup: SETUP, action: 'Save', onAnswer }));
  expect($<HTMLInputElement>('[data-field="project-owner"] input')!.value).toBe('maddec01');
  expect($$('[data-problem]').map(text)).toEqual(['Save needs the number, a positive whole number like 3.', 'Save needs the repository’s role.']);
  await type($<HTMLInputElement>('[data-field="role"] input')!, 'Web client');
  expect(onAnswer).toHaveBeenCalledWith({ role: 'Web client' });
  await settle(() => $('[data-choice="issues"] [role="radio"]')!.click());
  expect(onAnswer).toHaveBeenLastCalledWith({ itemSource: 'issues' });
});

const PICKS: CustomLabelPicks = { offered: ['app: music'], picked: ['app: web'], typed: '', adding: false, busy: false, error: null };

test('the custom label picker offers its labels and the picks, and calls back with a toggle, the typed label and Add', async () => {
  const handlers = { onToggle: vi.fn(), onType: vi.fn(), onAdd: vi.fn() };
  await mount(createElement(CustomLabelPicker, { repo: 'maddec01/lar-web', ...PICKS, typed: 'app: ios', ...handlers }));
  expect($$<HTMLElement>('[data-custom]').map((l) => l.dataset.custom)).toEqual(['app: music', 'app: web']);
  expect($('[data-custom="app: web"] [role="checkbox"]')!.getAttribute('aria-checked')).toBe('true');
  await settle(() => $('[data-custom="app: music"] [role="checkbox"]')!.click());
  expect(handlers.onToggle).toHaveBeenCalledWith('app: music');
  await type($<HTMLInputElement>('[data-new-custom]')!, 'app: mac');
  expect(handlers.onType).toHaveBeenCalledWith('app: mac');
  await settle(() => $('[data-add-custom]')!.click());
  expect(handlers.onAdd).toHaveBeenCalledOnce();
});

test("the custom label picker holds Add for a name that can't be a custom label, and shows a failed Add's message", async () => {
  const onAdd = vi.fn();
  await mount(createElement(CustomLabelPicker, { repo: 'maddec01/lar-web', ...PICKS, typed: 'status-list', error: { name: 'app: ios', message: 'gh: HTTP 403' }, onToggle: vi.fn(), onType: vi.fn(), onAdd }));
  expect($<HTMLButtonElement>('[data-add-custom]')!.disabled).toBe(true);
  await settle(() => $<HTMLInputElement>('[data-new-custom]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(onAdd).not.toHaveBeenCalled();
  expect(text($('[role="alert"]'))).toContain('Can’t create app: iosgh: HTTP 403');
});
