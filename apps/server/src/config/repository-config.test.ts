import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'vite-plus/test';

import { readRepositoryList, saveOnboarded, saveOnboarding } from './repository-config.ts';

async function dataDir(t: TestContext, files: Record<string, string> = {}): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lar repository config test '));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
    for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);

    return dir;
}

const progress = (step = 'setup', projectId = 'lar-apple') => ({ step, done: ['project'], answers: { projectId } });
const setup = { itemSource: 'issues', role: 'Apple app' };

test('the list file names the onboarded repositories, each still onboarding with its progress; a missing one names none', async (t) => {
    const onboarding = { ...progress(), answers: { projectId: 'lar-apple', provider: 'GitHub', setup } };
    const list = { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }] };

    assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'maddec01/lar-apple', onboarding },
    ]);
    assert.deepEqual(readRepositoryList(await dataDir(t)), []);
});

test('progress saved with the old show setting still resumes', async (t) => {
    const onboarding = {
        ...progress(),
        answers: { projectId: 'lar-apple', setup: { ...setup, show: 'some', showPicked: 'yes' } },
    };
    const list = { repositories: [{ repo: 'maddec01/lar-apple', onboarding }] };

    assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [
        { repo: 'maddec01/lar-apple', onboarding },
    ]);
});

test('saving an onboarding adds its repository to the list, or updates its entry, and keeps the other entries as they are', async (t) => {
    const dir = await dataDir(t, {
        'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }] }),
    });
    const file = join(dir, 'repository-settings.json');

    assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, dir), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'maddec01/lar-apple', onboarding: progress() },
    ]);
    saveOnboarding({ repo: 'maddec01/Lar-Apple', progress: progress('checks') }, null, dir);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
        repositories: [
            { repo: 'maddec01/lar-factory', note: 'kept' },
            { repo: 'maddec01/Lar-Apple', onboarding: progress('checks') },
        ],
    });
});

test('finishing an onboarding leaves its entry with the repository alone, in place of the entry it was saved under', async (t) => {
    const dir = await dataDir(t, {
        'repository-settings.json': JSON.stringify({
            repositories: [
                { repo: 'maddec01/lar-factory' },
                { repo: 'maddec01/lar-apple', onboarding: progress() },
                { repo: 'maddec01/lar-cli', onboarding: progress() },
            ],
        }),
    });

    assert.deepEqual(saveOnboarded('maddec01/lar-apple', null, dir), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'maddec01/lar-apple' },
        { repo: 'maddec01/lar-cli', onboarding: progress() },
    ]);
    assert.deepEqual(saveOnboarded('maddec01/lar-web', 'maddec01/lar-cli', dir), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'maddec01/lar-apple' },
        { repo: 'maddec01/lar-web' },
    ]);
    assert.throws(() => saveOnboarded('maddec01/lar-apple', null, dir), {
        message: 'maddec01/lar-apple is onboarded already.',
    });
});

test("saving an onboarding into a list that can't be read is refused", async (t) => {
    const broken = await dataDir(t, { 'repository-settings.json': '{ broken' });

    assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, broken), {
        message: `${join(broken, 'repository-settings.json')} isn't valid JSON.`,
    });
});

test('a list file naming a repository that would escape its folder is refused, naming its path', async (t) => {
    for (const shape of [{ repositories: [{ repo: 'maddec01/..' }] }, { repositories: [{ repo: '../lar-factory' }] }]) {
        const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify(shape) });

        assert.throws(
            () => readRepositoryList(dir),
            (err: Error) => err.message.startsWith(`${join(dir, 'repository-settings.json')}: `),
            JSON.stringify(shape),
        );
    }
});

test('removed-source onboarding entries do not break healthy repositories or later saves', async (t) => {
    const entries = ['github-project', 'azure-sprint', 'azure-backlog'].map((itemSource, index) => ({
        repo: `maddec01/old-${index}`,
        onboarding: { ...progress(), answers: { projectId: 'old', setup: { ...setup, itemSource } } },
    }));
    const dir = await dataDir(t, {
        'repository-settings.json': JSON.stringify({
            note: 'keep',
            repositories: [
                { repo: 'maddec01/healthy', note: 'keep' },
                ...entries,
                { repo: 'maddec01/current', onboarding: progress() },
            ],
        }),
    });

    assert.deepEqual(readRepositoryList(dir), [
        { repo: 'maddec01/healthy' },
        { repo: 'maddec01/current', onboarding: progress() },
    ]);
    saveOnboarding({ repo: 'maddec01/new', progress: progress() }, null, dir);

    const saved = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));

    assert.equal(saved.note, 'keep');
    assert.deepEqual(
        saved.repositories.map((entry: { repo: string }) => entry.repo),
        ['maddec01/healthy', 'maddec01/current', 'maddec01/new'],
    );
    assert.equal(saved.repositories[0].note, 'keep');
});
