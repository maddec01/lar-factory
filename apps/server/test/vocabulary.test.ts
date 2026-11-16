import type { BoardData } from '@lar-factory/shared';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { startBoard, writesRepository } from './server-support.ts';

const repo = 'team/app';
const choices = { labels: ['bug', 'feature'], types: ['Task'] };
const answers = {
    repo,
    projectId: 'app',
    structureSync: false,
    itemSource: { kind: 'issues' },
    domainDocs: { kind: 'off' },
    skills: [],
};

test("renaming and deleting a mapped label changes the board row's mapping at once", async (t) => {
    const board = await startBoard(t, {
        repositories: [repo],
        vocabulary: { ...choices, labels: ['bug', 'feature', 'triage'] },
    });

    await board.post(
        { repo, change: 'vocabulary', key: 'improvement', value: { type: null, labels: ['triage', 'feature'] } },
        board.url,
        '/api/repositories/settings',
    );

    const mapped = async (response: Response) => {
        const { board: data } = (await response.json()) as { board: BoardData };

        return data.repos.find((r) => r.repo === repo)?.setup?.vocabulary.improvement.labels;
    };
    const labels = (body: object) => board.post({ repo, ...body }, board.url, '/api/repositories/labels');

    expect(await mapped(await labels({ change: 'update', name: 'triage', update: { name: 'sorting' } }))).toEqual([
        'sorting',
        'feature',
    ]);
    expect(await mapped(await labels({ change: 'delete', name: 'sorting' }))).toEqual(['feature']);
});

test('onboarding creates a typed label only on explicit save and refuses unverified Access', async (t) => {
    const board = await startBoard(t, { repositories: [], vocabulary: choices });
    const saved = await board.post(
        { ...answers, vocabulary: { bug: { type: null, labels: ['bug'] } }, newLabels: { bug: ['triage'] } },
        board.url,
        '/api/onboarding/setup',
    );

    expect(saved.status).toBe(200);

    const local = JSON.parse(await readFile(join(board.dataDir, 'repository-settings.json'), 'utf8'));

    expect(local.repositories[0].settings.overrides.vocabulary.bug).toEqual({ type: null, labels: ['bug', 'triage'] });

    const denied = await startBoard(t, { repositories: [], vocabulary: choices, oauthScopes: null });
    const refused = await denied.post(
        { ...answers, newLabels: { feature: ['triage'] } },
        denied.url,
        '/api/onboarding/setup',
    );

    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toMatch(/isn’t checked yet/);
    expect((await denied.calls()).filter(writesRepository)).toEqual([]);
});
