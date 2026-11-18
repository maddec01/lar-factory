import type { BoardData, SetupDetection } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { startBoard, writesRepository } from './server-support.ts';

/** This Mac's list under `home` as the file holds it, leaving out each entry's local settings, which the board's reads add. */
function listFile(home: string): { repositories: Record<string, unknown>[] } {
    const file = JSON.parse(
        readFileSync(join(home, 'Library/Application Support/Lar Factory/repository-settings.json'), 'utf8'),
    );

    return {
        ...file,
        repositories: file.repositories.map(({ settings: _, ...entry }: Record<string, unknown>) => entry),
    };
}

const progress = { step: 'setup', done: ['project'], answers: { projectId: 'web' } };

test('closing onboarding keeps its repository on the list as onboarding, which the board shows at once and after a restart', async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));

    const board = await startBoard(t, { repositories: null }, false, false, { HOME: home });
    const response = await board.post({ repo: 'acme/web', progress }, board.url, '/api/onboarding/repositories');

    assert.equal(response.status, 200);
    assert.deepEqual(((await response.json()) as { board: BoardData }).board.onboarding, [
        { repo: 'acme/web', progress },
    ]);
    assert.deepEqual(listFile(home), { repositories: [{ repo: 'acme/web', onboarding: progress }] });
    await board.stop();

    const restarted = await startBoard(t, {}, false, false, { HOME: home });

    assert.deepEqual(((await restarted.board()) as BoardData).onboarding, [{ repo: 'acme/web', progress }]);
});

const ANSWERS = {
    structureSync: false,
    projectId: 'web',
    role: 'Web client',
    itemSource: { kind: 'issues' },
    domainDocs: { kind: 'off' },
    skills: [],
};

test('a fine-grained read-only token permits local setup without enabling concept sync', async (t) => {
    const board = await startBoard(t, { repositories: [], oauthScopes: null });
    const detected = await board.post({ repo: 'acme/web', projectId: 'web' }, board.url, '/api/onboarding/detect');
    const { detection } = (await detected.json()) as { detection: SetupDetection };

    assert.ok(Object.values(detection.access).every((value) => value === 'unverified'));

    const saved = await board.post(
        { repo: 'acme/web', ...ANSWERS, structureSync: true },
        board.url,
        '/api/onboarding/setup',
    );

    assert.equal(saved.status, 200);
    assert.deepEqual(((await saved.json()) as { board: BoardData }).board.onboarding, []);
    assert.deepEqual((await board.calls()).filter(writesRepository), []);
});
