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

const progress = (step = 'setup', projectId = 'ios') => ({ step, done: ['project'], answers: { projectId } });
const setup = { itemSource: 'issues', role: 'Apple app' };

test('the list file names the onboarded repositories, each still onboarding with its progress; a missing one names none', async (t) => {
    const onboarding = { ...progress(), answers: { projectId: 'ios', provider: 'GitHub', setup } };
    const list = { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'acme/ios', onboarding }] };

    assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'acme/ios', onboarding },
    ]);
    assert.deepEqual(readRepositoryList(await dataDir(t)), []);
});

test('progress saved with the old show setting still resumes', async (t) => {
    const onboarding = {
        ...progress(),
        answers: { projectId: 'ios', setup: { ...setup, show: 'some', showPicked: 'yes' } },
    };
    const list = { repositories: [{ repo: 'acme/ios', onboarding }] };

    assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [
        { repo: 'acme/ios', onboarding },
    ]);
});

test('saving an onboarding adds its repository to the list, or updates its entry, and keeps the other entries as they are', async (t) => {
    const dir = await dataDir(t, {
        'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }] }),
    });
    const file = join(dir, 'repository-settings.json');

    assert.deepEqual(saveOnboarding({ repo: 'acme/ios', progress: progress() }, null, dir), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'acme/ios', onboarding: progress() },
    ]);
    saveOnboarding({ repo: 'acme/Ios', progress: progress('checks') }, null, dir);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
        repositories: [
            { repo: 'maddec01/lar-factory', note: 'kept' },
            { repo: 'acme/Ios', onboarding: progress('checks') },
        ],
    });
});

test('finishing an onboarding leaves its entry with the repository alone, in place of the entry it was saved under', async (t) => {
    const dir = await dataDir(t, {
        'repository-settings.json': JSON.stringify({
            repositories: [
                { repo: 'maddec01/lar-factory' },
                { repo: 'acme/ios', onboarding: progress() },
                { repo: 'acme/cli', onboarding: progress() },
            ],
        }),
    });

    assert.deepEqual(saveOnboarded('acme/ios', null, dir), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'acme/ios' },
        { repo: 'acme/cli', onboarding: progress() },
    ]);
    assert.deepEqual(saveOnboarded('acme/web', 'acme/cli', dir), [
        { repo: 'maddec01/lar-factory' },
        { repo: 'acme/ios' },
        { repo: 'acme/web' },
    ]);
    assert.throws(() => saveOnboarded('acme/ios', null, dir), {
        message: 'acme/ios is onboarded already.',
    });
});

test("saving an onboarding into a list that can't be read is refused", async (t) => {
    const broken = await dataDir(t, { 'repository-settings.json': '{ broken' });

    assert.throws(() => saveOnboarding({ repo: 'acme/ios', progress: progress() }, null, broken), {
        message: `${join(broken, 'repository-settings.json')} isn't valid JSON.`,
    });
});

test('a list file naming a repository that would escape its folder is refused, naming its path', async (t) => {
    for (const shape of [{ repositories: [{ repo: 'acme/..' }] }, { repositories: [{ repo: '../lar-factory' }] }]) {
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
        repo: `acme/old-${index}`,
        onboarding: { ...progress(), answers: { projectId: 'old', setup: { ...setup, itemSource } } },
    }));
    const dir = await dataDir(t, {
        'repository-settings.json': JSON.stringify({
            note: 'keep',
            repositories: [
                { repo: 'acme/healthy', note: 'keep' },
                ...entries,
                { repo: 'acme/current', onboarding: progress() },
            ],
        }),
    });

    assert.deepEqual(readRepositoryList(dir), [
        { repo: 'acme/healthy' },
        { repo: 'acme/current', onboarding: progress() },
    ]);
    saveOnboarding({ repo: 'acme/new', progress: progress() }, null, dir);

    const saved = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));

    assert.equal(saved.note, 'keep');
    assert.deepEqual(
        saved.repositories.map((entry: { repo: string }) => entry.repo),
        ['acme/healthy', 'acme/current', 'acme/new'],
    );
    assert.equal(saved.repositories[0].note, 'keep');
});
