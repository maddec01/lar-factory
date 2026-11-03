// Settings › General: the heavy command limit, Automatic or a typed whole number from 1, which posts to the board server
// and shows the board it answers with.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData, HeavyCommandLimitState } from '@lar-factory/shared';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';

const row = () => $('.settings-row[data-row="heavy-command-limit"]')!;
const radios = () => $$<HTMLButtonElement>('[data-heavy-command-limit] [role="radio"]');
const radio = (value: string) => radios().find((r) => r.value === value)!;
const picked = () => radios().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.value);
const input = () => $<HTMLInputElement>('[data-heavy-command-limit] input[aria-label="Heavy command limit"]');
const saveButton = () => $<HTMLButtonElement>('[data-save-heavy-command-limit]')!;
const alerts = () => $$('[data-heavy-command-limit] [role="alert"]').map(text);
const posted = () => fetchMock.mock.calls.filter(([url]) => url === '/api/heavy-command-limit').map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const withLimit = (state?: HeavyCommandLimitState): BoardData => ({ ...sample, ...state && { heavyCommandLimit: state } });

async function openGeneral(data: BoardData): Promise<void> {
  fetchMock.mockImplementation((async () => new Response(JSON.stringify(data))) as never);
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

/** Answers a POST of the setting with `status` and `body`. */
function answerSave(status: number, body: object): void {
  fetchMock.mockImplementation((async () => new Response(JSON.stringify(body), { status })) as never);
}

async function type(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  await settle(() => input()!.dispatchEvent(new Event('input', { bubbles: true })));
}

test('General has the row in its own group, showing Automatic with the number it gives', async () => {
  await openGeneral(withLimit({ limit: 'automatic', automatic: 3 }));
  expect(row().closest('section')!.querySelectorAll('.settings-row')).toHaveLength(1);
  expect(text(row().querySelector('.settings-row-title'))).toBe('Heavy commands at once');
  expect(radios().map((r) => text(r.closest('label') ?? r.parentElement))).toEqual(['Automatic (3)', 'Number']);
  expect(picked()).toEqual(['automatic']);
  expect(input()).toBeNull();
});

test('A saved number shows in its field', async () => {
  await openGeneral(withLimit({ limit: 5, automatic: 2 }));
  expect(picked()).toEqual(['number']);
  expect(input()!.value).toBe('5');
});

test('Typing a whole number from 1 saves it and shows the board the server answers with', async () => {
  await openGeneral(withLimit({ limit: 'automatic', automatic: 2 }));
  await settle(() => radio('number').click());
  await type('4');
  answerSave(200, { error: null, board: withLimit({ limit: 4, automatic: 2 }) });
  await settle(() => saveButton().click());
  expect(posted()).toEqual([{ limit: 4 }]);
  expect(picked()).toEqual(['number']);
  expect(input()!.value).toBe('4');
  expect(alerts()).toEqual([]);
});

test('The row refuses anything but a whole number from 1', async () => {
  await openGeneral(withLimit({ limit: 'automatic', automatic: 2 }));
  await settle(() => radio('number').click());
  for (const value of ['', '0', '-1', '2.5', 'many']) {
    await type(value);
    expect(saveButton().disabled, value).toBe(true);
    if (value) expect(text(row()), value).toContain('Enter a whole number from 1.');
  }
  expect(posted()).toEqual([]);
});

test('Picking Automatic saves it', async () => {
  await openGeneral(withLimit({ limit: 5, automatic: 2 }));
  answerSave(200, { error: null, board: withLimit({ limit: 'automatic', automatic: 2 }) });
  await settle(() => radio('automatic').click());
  expect(posted()).toEqual([{ limit: 'automatic' }]);
  expect(picked()).toEqual(['automatic']);
  expect(input()).toBeNull();
});

test('An invalid file picks no option, with a note, and picking Automatic replaces it', async () => {
  const problem = 'The heavy command limit setting /data/heavy-command-limit.json needs a limit of "automatic" or a whole number from 1.';
  await openGeneral(withLimit({ limit: 'automatic', automatic: 2, problem }));
  expect(picked()).toEqual([]);
  expect(alerts()).toEqual([`${problem} The board uses Automatic until you save a choice.`]);
  answerSave(200, { error: null, board: withLimit({ limit: 'automatic', automatic: 2 }) });
  await settle(() => radio('automatic').click());
  expect(posted()).toEqual([{ limit: 'automatic' }]);
  expect(picked()).toEqual(['automatic']);
  expect(alerts()).toEqual([]);
});

test('Switching to Number starts from the Automatic number', async () => {
  await openGeneral(withLimit({ limit: 'automatic', automatic: 3 }));
  await settle(() => radio('number').click());
  expect(input()!.value).toBe('3');
});

test('Enter in the field saves the number', async () => {
  await openGeneral(withLimit({ limit: 5, automatic: 2 }));
  await type('6');
  answerSave(200, { error: null, board: withLimit({ limit: 6, automatic: 2 }) });
  await settle(() => input()!.form!.requestSubmit());
  expect(posted()).toEqual([{ limit: 6 }]);
});

test('Save keeps focus and stays unavailable while the field holds the saved number', async () => {
  await openGeneral(withLimit({ limit: 5, automatic: 2 }));
  expect(saveButton().getAttribute('aria-disabled')).toBe('true');
  await settle(() => input()!.form!.requestSubmit());
  expect(posted()).toEqual([]);
  await type('6');
  expect(saveButton().hasAttribute('aria-disabled')).toBe(false);
  answerSave(200, { error: null, board: withLimit({ limit: 6, automatic: 2 }) });
  saveButton().focus();
  await settle(() => saveButton().click());
  expect(posted()).toEqual([{ limit: 6 }]);
  expect(saveButton().getAttribute('aria-disabled')).toBe('true');
  expect(document.activeElement).toBe(saveButton());
});

test('The whole-number hint describes the field it refuses', async () => {
  await openGeneral(withLimit({ limit: 5, automatic: 2 }));
  expect(input()!.hasAttribute('aria-invalid')).toBe(false);
  await type('many');
  expect(input()!.getAttribute('aria-invalid')).toBe('true');
  expect(text(document.getElementById(input()!.getAttribute('aria-describedby')!))).toBe('Enter a whole number from 1.');
});

test('In sample mode nothing is picked and a save shows why it was refused', async () => {
  await openGeneral(withLimit());
  expect(picked()).toEqual([]);
  answerSave(403, { error: 'The heavy command limit is disabled in sample mode.' });
  await settle(() => radio('automatic').click());
  expect(picked()).toEqual([]);
  expect(alerts()).toEqual(['The heavy command limit is disabled in sample mode.']);
});
