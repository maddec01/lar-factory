import type { SnapshotRunInput } from '@lar-factory/shared/run-settings';
import { openWorkRecords, workRecordsPath, type WorkRecords } from '@lar-factory/work-records';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { refreshReleaseFolders, runningRelease } from './release-folders.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const logged: string[] = [];
const log = (message: string) => void logged.push(message);

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    logged.length = 0;
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'lar-release-folders-'));

    dirs.push(dir);

    const bundle = join(dir, 'app-bundle');

    mkdirSync(join(bundle, 'skills', 'lar-build'), { recursive: true });
    writeFileSync(join(bundle, 'skills', 'lar-build', 'SKILL.md'), 'Build, release 2.');
    writeFileSync(join(bundle, 'UPSTREAM.md'), 'Credits.');

    const dataDir = join(dir, 'data');
    const records = await openWorkRecords(workRecordsPath(dataDir));

    opened.push(records);

    return { bundle, dataDir, records, bundles: join(dataDir, 'bundles') };
}

/** A build of its own whose one run started on `release`. */
function runOn(records: WorkRecords, release: string) {
    const { workId } = records.create({ title: `Run on ${release}`, repository: 'test/repo', kind: 'build' });
    const input: SnapshotRunInput = {
        runId: `run-${release}`,
        kind: 'build',
        packaged: { version: 'sha256:x', reviewers: { code: 'C', security: 'S', ui: 'U', performance: 'P' } },
        skills: [],
        release,
    };

    records.snapshotRun(workId, records.read(workId).revision, input);

    return workId;
}

function oldRelease(bundles: string, release: string) {
    mkdirSync(join(bundles, release, 'skills', 'lar-build'), { recursive: true });
    writeFileSync(join(bundles, release, 'skills', 'lar-build', 'SKILL.md'), `Build, release ${release}.`);
}

it('copies the running release and keeps only the releases active runs use', async () => {
    const { bundle, dataDir, records, bundles } = await fixture();

    for (const release of ['0.9.0', '1.0.0', '1.1.0', '1.2.0']) oldRelease(bundles, release);
    runOn(records, '1.0.0');

    const finished = runOn(records, '1.1.0');

    records.recordFinished(finished, records.read(finished).revision);

    const aside = runOn(records, '1.2.0');

    records.setAside(aside, records.read(aside).revision);

    refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records, log });

    expect(readdirSync(bundles).sort()).toEqual(['1.0.0', '2.0.0']);
    expect(readFileSync(join(bundles, '2.0.0', 'skills', 'lar-build', 'SKILL.md'), 'utf8')).toBe('Build, release 2.');
    expect(readFileSync(join(bundles, '2.0.0', 'UPSTREAM.md'), 'utf8')).toBe('Credits.');
    expect(logged).toEqual([]);
});

it('leaves a complete release folder as it is', async () => {
    const { bundle, dataDir, records, bundles } = await fixture();

    oldRelease(bundles, '2.0.0');
    refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records, log });

    expect(readFileSync(join(bundles, '2.0.0', 'skills', 'lar-build', 'SKILL.md'), 'utf8')).toBe(
        'Build, release 2.0.0.',
    );
});

it('never deletes the running release, even when no run uses it', async () => {
    const { bundle, dataDir, records, bundles } = await fixture();

    refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records, log });
    refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records, log });

    expect(readdirSync(bundles)).toEqual(['2.0.0']);
});

it('leaves no partial release folder when the copy is interrupted, and logs instead of throwing', async () => {
    const { bundle, dataDir, records, bundles } = await fixture();

    oldRelease(bundles, '1.0.0');
    runOn(records, '1.0.0');
    writeFileSync(join(bundle, 'skills', 'lar-build', 'unreadable.md'), 'Hidden.');
    chmodSync(join(bundle, 'skills', 'lar-build', 'unreadable.md'), 0o000);

    expect(() => refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records, log })).not.toThrow();

    expect(readdirSync(bundles)).toEqual(['1.0.0']);
    expect(logged).toEqual([expect.stringContaining("Couldn't copy release 2.0.0")]);
});

it("leaves a running copy's temporary folder in place and deletes an abandoned one", async () => {
    const { bundle, dataDir, records, bundles } = await fixture();
    const running = `.3.0.0-beta-${process.pid}-456`;
    const abandoned = `.3.0.0-${spawnSync(process.execPath, ['-e', '']).pid}-456`;

    for (const name of [running, abandoned]) mkdirSync(join(bundles, name, 'skills'), { recursive: true });
    refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records, log });

    expect(readdirSync(bundles).sort()).toEqual([running, '2.0.0']);
});

it('deletes nothing without the work records, which name the releases in use', async () => {
    const { bundle, dataDir, bundles } = await fixture();

    oldRelease(bundles, '1.0.0');
    refreshReleaseFolders({ bundle, dataDir, release: '2.0.0', records: null, log });

    expect(readdirSync(bundles).sort()).toEqual(['1.0.0', '2.0.0']);
});

it('reads the running release only from a nonempty app version', () => {
    expect(runningRelease({ BOARD_APP_VERSION: '2.0.0' })).toBe('2.0.0');
    expect(runningRelease({ BOARD_APP_VERSION: '' })).toBeUndefined();
    expect(runningRelease({})).toBeUndefined();
    expect(runningRelease({ BOARD_APP_VERSION: '../2.0.0' })).toBeUndefined();
});
