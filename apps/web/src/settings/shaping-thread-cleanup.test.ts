// Settings › General: the choice for an item's shaping threads after Start build, which posts to the board server and
// shows the board it answers with.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData, ShapingThreadCleanupState } from '@lar-factory/shared';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';

const row = () => $('.settings-row[data-row="shaping-thread-cleanup"]')!;
const radios = () => $$<HTMLButtonElement>('[data-shaping-thread-cleanup] [role="radio"]');
const radio = (value: string) => radios().find((r) => r.value === value)!;
const picked = () => radios().filter((r) => r.getAttribute('aria-checked') === 'true').map((r) => r.value);
const posted = () => fetchMock.mock.calls.filter(([url]) => url === '/api/shaping-thread-cleanup').map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const withChoice = (state?: ShapingThreadCleanupState): BoardData => ({ ...sample, ...state && { shapingThreadCleanup: state } });

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

test('General has the row in its own group, with the four choices and what each does', async () => {
  await openGeneral(withChoice({ choice: 'archive' }));
  const group = row().closest('section')!;
  expect(group.querySelectorAll('.settings-row')).toHaveLength(1);
  expect(text(row().querySelector('.settings-row-title'))).toBe('Shaping threads after Start build');
  expect(radios().map((r) => r.value)).toEqual(['keep', 'settle', 'archive', 'delete']);
  expect(picked()).toEqual(['archive']);
  const description = text(row());
  for (const said of ['Keep changes nothing', 'Settle', 'Archive', "Delete can't be undone from the board", "item's stats no longer count"]) expect(description).toContain(said);
});

test('Picking a choice saves it and shows the board the server answers with', async () => {
  await openGeneral(withChoice({ choice: 'archive' }));
  answerSave(200, { error: null, board: withChoice({ choice: 'delete' }) });
  await settle(() => radio('delete').click());
  expect(posted()).toEqual([{ choice: 'delete' }]);
  expect(picked()).toEqual(['delete']);
  expect($('[data-shaping-thread-cleanup] [role="alert"]')).toBeNull();
});

test('A refused save shows why and keeps the saved choice', async () => {
  await openGeneral(withChoice());
  expect(picked(), 'sample mode has no choice to show').toEqual([]);
  answerSave(403, { error: 'Shaping thread cleanup is disabled in sample mode.' });
  await settle(() => radio('keep').click());
  expect(picked()).toEqual([]);
  expect(text($('[data-shaping-thread-cleanup] [role="alert"]'))).toBe('Shaping thread cleanup is disabled in sample mode.');
});

test('An unreadable setting shows why, and saving a choice clears it', async () => {
  const problem = "The shaping thread cleanup setting /data/shaping-thread-cleanup.json isn't JSON: bad.";
  await openGeneral(withChoice({ problem }));
  expect(picked()).toEqual([]);
  expect(text($('[data-shaping-thread-cleanup] [role="alert"]'))).toBe(`${problem} Saving a choice replaces the file.`);
  answerSave(200, { error: null, board: withChoice({ choice: 'settle' }) });
  await settle(() => radio('settle').click());
  expect(picked()).toEqual(['settle']);
  expect($('[data-shaping-thread-cleanup] [role="alert"]')).toBeNull();
});
