// Settings › General: the model Auto-build starts builds on, Project default in T3 or one of the model choices Start offers, which
// posts to the board server and shows the board it answers with.

import type { BoardData, ModelGroup } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fetchMock, mountPage, openOptions, sample, settle, text } from '@/test/PageTest';

const CHOICES: ModelGroup[] = [
    { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
    { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
];
const OPUS = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };
const row = () => $('.settings-row[data-row="auto-build-model"]')!;
const trigger = () => row().querySelector<HTMLButtonElement>('[aria-label="Auto-build model"]')!;
const posted = () =>
    fetchMock.mock.calls
        .filter(([url]) => url === '/api/auto-build')
        .map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const entries = () => $$('[role="option"]');

async function chooseModel(label: string): Promise<void> {
    await openOptions(trigger());
    await settle(() =>
        entries()
            .find((entry) => text(entry) === label)!
            .click(),
    );
    await settle(() => vi.advanceTimersByTime(50));
}

const withAutoBuild = (autoBuild?: BoardData['autoBuild']): BoardData => ({
    ...sample,
    modelChoices: CHOICES,
    ...(autoBuild && { autoBuild }),
});

async function openGeneral(data: BoardData): Promise<void> {
    fetchMock.mockImplementation((async () => new Response(JSON.stringify(data))) as never);
    await mountPage(data);
    await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
    await settle(() => vi.advanceTimersByTime(50));
}

test('picking a model saves it, and picking Project default in T3 saves none', async () => {
    await openGeneral(withAutoBuild({ on: false }));
    fetchMock.mockImplementation(
        (async () =>
            new Response(JSON.stringify({ error: null, board: withAutoBuild({ on: false, model: OPUS }) }))) as never,
    );
    await chooseModel('Claude Opus 5.5');
    expect(text(trigger())).toBe('Claude Opus 5.5');
    fetchMock.mockImplementation(
        (async () => new Response(JSON.stringify({ error: null, board: withAutoBuild({ on: false }) }))) as never,
    );
    await chooseModel('Project default in T3');
    expect(posted()).toEqual([{ model: OPUS }, { model: null }]);
    expect(text(trigger())).toBe('Project default in T3');
});

test('a saved model the choices no longer offer still shows, and says so', async () => {
    await openGeneral(withAutoBuild({ on: true, model: { instanceId: 'cursor', model: 'cursor-agent' } }));
    expect(text(trigger())).toBe('cursor cursor-agent (not offered)');
    await openOptions(trigger());

    const missing = entries().at(-1)!;

    expect(missing.getAttribute('data-state')).toBe('checked');
    expect(missing.getAttribute('aria-disabled')).toBe('true');
    await settle(() => missing.click());
    expect(posted()).toEqual([]);
});
