// Settings › General: the model Auto-build starts builds on, T3 default or one of the model choices Start offers, which
// posts to the board server and shows the board it answers with.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData, ModelGroup } from '@lar-factory/shared';
import { $, chooseOption, fetchMock, mountPage, openOptions, sample, settle, text } from '../../test/support.ts';

const CHOICES: ModelGroup[] = [
  { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
  { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
];
const OPUS = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };
const row = () => $('.settings-row[data-row="auto-build-model"]')!;
const trigger = () => row().querySelector<HTMLButtonElement>('[aria-label="Auto-build model"]')!;
const posted = () => fetchMock.mock.calls.filter(([url]) => url === '/api/auto-build').map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const withAutoBuild = (autoBuild?: BoardData['autoBuild']): BoardData => ({ ...sample, modelChoices: CHOICES, ...autoBuild && { autoBuild } });

async function openGeneral(data: BoardData): Promise<void> {
  fetchMock.mockImplementation((async () => new Response(JSON.stringify(data))) as never);
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

test('General offers T3 default and each model choice, with T3 default picked until another is saved', async () => {
  await openGeneral(withAutoBuild({ on: false }));
  expect(text(row().querySelector('.settings-row-title'))).toBe('Auto-build model');
  expect(text(trigger())).toBe('T3 default');
  expect(await openOptions(trigger())).toEqual(['T3 default', 'Claude Opus 5.5', 'Codex GPT-5.5']);
});

test('a saved model shows as picked', async () => {
  await openGeneral(withAutoBuild({ on: true, model: OPUS }));
  expect(text(trigger())).toBe('Claude Opus 5.5');
});

test('picking a model saves it, and picking T3 default saves none', async () => {
  await openGeneral(withAutoBuild({ on: false }));
  fetchMock.mockImplementation((async () => new Response(JSON.stringify({ error: null, board: withAutoBuild({ on: false, model: OPUS }) }))) as never);
  await chooseOption(trigger(), 'Claude Opus 5.5');
  expect(text(trigger())).toBe('Claude Opus 5.5');
  fetchMock.mockImplementation((async () => new Response(JSON.stringify({ error: null, board: withAutoBuild({ on: false }) }))) as never);
  await chooseOption(trigger(), 'T3 default');
  expect(posted()).toEqual([{ model: OPUS }, { model: null }]);
  expect(text(trigger())).toBe('T3 default');
});

test('a saved model the choices no longer offer still shows, and says so', async () => {
  await openGeneral(withAutoBuild({ on: true, model: { instanceId: 'cursor', model: 'cursor-agent' } }));
  expect(text(trigger())).toBe('cursor cursor-agent (not offered)');
});

test('a refused save shows why', async () => {
  await openGeneral(withAutoBuild({ on: false }));
  fetchMock.mockImplementation((async () => new Response(JSON.stringify({ error: "That model choice isn't offered. Pick another one.", board: withAutoBuild({ on: false }) }), { status: 422 })) as never);
  await chooseOption(trigger(), 'Codex GPT-5.5');
  expect(text(row().querySelector('[role="alert"]'))).toBe("That model choice isn't offered. Pick another one.");
  expect(text(trigger())).toBe('T3 default');
});

test('the choice is disabled in sample mode, which has no Auto-build', async () => {
  await openGeneral(withAutoBuild());
  expect([text(trigger()), trigger().disabled]).toEqual(['T3 default', true]);
});
