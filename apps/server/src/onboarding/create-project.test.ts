import type { ProjectChoice } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { createProject } from './create-project.ts';

/** A home with an empty folder `lar-web` in it. */
function home(t: TestContext): string {
    const dir = mkdtempSync(join(tmpdir(), 'lar-create-home-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'lar-web'));

    return dir;
}

const choice = (id: string, folder: string): ProjectChoice => ({
    id,
    name: id,
    folder,
    shownFolder: folder,
    repo: `maddec01/${id}`,
    provider: 'GitHub',
    blocked: null,
    onBoard: false,
    icon: null,
});

test("adds the folder to T3 and answers with T3's projects and the new one's id", async (t) => {
    const dir = home(t);
    const added: string[] = [];
    const projects = [choice('notes', '/elsewhere'), choice('lar-web', join(dir, 'lar-web'))];
    const answer = await createProject(
        { folder: '~/lar-web/' },
        async () => projects,
        { HOME: dir },
        async (folder) => {
            added.push(folder);

            return null;
        },
    );

    assert.deepEqual(added, [join(dir, 'lar-web')]);
    assert.deepEqual(answer, { projects, projectId: 'lar-web' });
});
