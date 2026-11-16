// Connections: each pair of onboarded repositories the user related, kept once in the local repository list.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vite-plus/test';

import { readConnections, saveConnections } from './repository-list.ts';

const WEB = 'maddec01/lar-web';
const API = 'maddec01/lar-api';
const IOS = 'maddec01/lar-ios';

/** A data folder whose list names `repos`, each on the board. */
function dataDir(repos: string[] = [WEB, API, IOS]): string {
    const dir = mkdtempSync(join(tmpdir(), 'lar repository list test '));

    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
        join(dir, 'repository-settings.json'),
        JSON.stringify({ repositories: repos.map((repo) => ({ repo })) }),
    );

    return dir;
}

test('a Connection reads the same from either repository', () => {
    const dir = dataDir();

    saveConnections(WEB, [API], dir);
    assert.deepEqual(readConnections(WEB, dir), [API]);
    assert.deepEqual(readConnections(API, dir), [WEB]);
    assert.deepEqual(readConnections(IOS, dir), []);
});

test("saving a repository's Connections replaces its pairs, so an unticked one goes", () => {
    const dir = dataDir();

    saveConnections(WEB, [API, IOS], dir);
    saveConnections(API, [IOS], dir);
    saveConnections(WEB, [IOS], dir);
    assert.deepEqual(readConnections(WEB, dir), [IOS]);
    assert.deepEqual(readConnections(API, dir), [IOS]);
});
