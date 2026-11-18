import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'vite-plus/test';

import { keepOnboarding } from './keep-onboarding.ts';

const progress = { step: 'setup', done: ['project'], answers: { projectId: 'web' } };

async function dataDir(t: TestContext): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lar keep onboarding test '));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

    return dir;
}

test('keeping an onboarding returns the repositories still onboarding, the one it replaces gone', async (t) => {
    const dir = await dataDir(t);

    assert.deepEqual(await keepOnboarding({ repo: 'acme/ios', progress }, dir), {
        onboarding: [{ repo: 'acme/ios', progress }],
    });
    assert.deepEqual(await keepOnboarding({ repo: 'acme/web', progress, replaces: 'acme/ios' }, dir), {
        onboarding: [{ repo: 'acme/web', progress }],
    });
});

test("only the step, done steps and answers of the body's progress are saved", async (t) => {
    const dir = await dataDir(t);

    assert.deepEqual(
        await keepOnboarding(
            { repo: 'acme/web', progress: { ...progress, prUrl: 'https://evil.example/pull/1' } },
            dir,
        ),
        { onboarding: [{ repo: 'acme/web', progress }] },
    );
});
