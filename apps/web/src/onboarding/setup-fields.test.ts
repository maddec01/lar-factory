// The setup fields and the custom label picker outside the wizard: each shows the values it's given and calls back with
// the user's changes, with no store behind it.

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import type { SetupAnswers } from '@lar-factory/shared';
import { $, $$, checkedOf, fetchMock, settle, text } from '../../test/support.ts';
import { CustomLabelPicker, SetupFields, type CustomLabelPicks } from './setup-fields.tsx';

const SETUP: SetupAnswers = { itemSource: 'issues', show: 'all', showPicked: false, role: '' };

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  document.body.innerHTML = '<div id="root"></div>';
  await act(async () => createRoot($('#root')!).render(element));
}

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

test('setup shows the fixed source and calls back with description and Show changes', async () => {
  const onAnswer = vi.fn();
  await mount(createElement(SetupFields, { repo: 'maddec01/lar-web', setup: { ...SETUP, itemSource: 'issues' }, action: 'Save', onAnswer }));
  expect($('[data-choice="issues"]')).toBeNull();
  expect($$('[data-problem]').map(text)).toEqual(['Describe what this repository does to continue with Save.']);
  await type($<HTMLInputElement>('[data-field="role"] input')!, 'Web client');
  expect(onAnswer).toHaveBeenCalledWith({ role: 'Web client' });
  await settle(() => $('[data-choice="opted-in"] [role="radio"]')!.click());
  expect(onAnswer).toHaveBeenLastCalledWith({ show: 'opted-in' });
});

const PICKS: CustomLabelPicks = { offered: ['app: music'], picked: ['app: web'], typed: '', adding: false, busy: false, error: null };

test('the custom label picker offers its labels and the picks, and calls back with a toggle, the typed label and Add', async () => {
  const handlers = { onToggle: vi.fn(), onType: vi.fn(), onAdd: vi.fn() };
  await mount(createElement(CustomLabelPicker, { repo: 'maddec01/lar-web', ...PICKS, typed: 'app: ios', ...handlers }));
  expect($$<HTMLElement>('[data-custom]').map((l) => l.dataset.custom)).toEqual(['app: music', 'app: web']);
  expect(checkedOf($('[data-custom="app: web"] input[type="checkbox"]')!)).toBe('true');
  await settle(() => $('[data-custom="app: music"] input[type="checkbox"]')!.click());
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
  expect(text($('[role="alert"]'))).toContain('Could not add app: iosgh: HTTP 403');
});

test('Azure offers real teams, leaves several unselected, and preselects a sole team', async () => {
  const onAnswer = vi.fn();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ teams: ['App', 'Controls', 'DepotAndTrading'] })));
  await mount(createElement(SetupFields, { repo: 'contoso/VanEckDirect/api', azure: true, setup: { ...SETUP, itemSource: 'azure-board', team: '' }, onAnswer }));
  await settle(() => {});
  expect($$<HTMLOptionElement>('[data-field="team"] option').map((o) => o.value)).toEqual(['', 'App', 'Controls', 'DepotAndTrading']);
  expect(onAnswer).not.toHaveBeenCalled();
  const select = $<HTMLSelectElement>('[data-field="team"] select')!;
  await settle(() => { select.value = 'App'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(onAnswer).toHaveBeenCalledWith({ team: 'App' });
  onAnswer.mockClear();
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ teams: ['Only team'] })));
  await mount(createElement(SetupFields, { repo: 'contoso/Other/api', azure: true, setup: { ...SETUP, itemSource: 'azure-board', team: '' }, onAnswer }));
  expect(onAnswer).toHaveBeenCalledWith({ team: 'Only team' });
});

test('Show choices include counts when available, including zero', async () => {
  await mount(createElement(SetupFields, { repo: 'maddec01/api', setup: SETUP, counts: { all: 23, 'opted-in': 0 }, onAnswer: vi.fn() }));
  expect(text($('[data-choice="all"]'))).toContain('23 items');
  expect(text($('[data-choice="opted-in"]'))).toContain('0 items');
});

test('a team read failure offers Retry without guessing a name', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  await mount(createElement(SetupFields, { repo: 'contoso/Example/api', azure: true, setup: { ...SETUP, itemSource: 'azure-board', team: '' }, onAnswer: vi.fn() }));
  await settle();
  expect(text($('[role="alert"]'))).toContain("Can't reach the board");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ teams: ['App', 'Controls'] })));
  await settle(() => $('[role="alert"] button')!.click());
  expect($$<HTMLOptionElement>('[data-field="team"] option').map((o) => o.value)).toEqual(['', 'App', 'Controls']);
});
