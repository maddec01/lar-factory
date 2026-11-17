import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vite-plus/test';

import { agentWrites } from './agent-writes.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const fixtures: { dir: string; records: WorkRecords }[] = [];

afterEach(() => {
    for (const { dir, records } of fixtures.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const packaged = {
    version: 'fixture',
    reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
};
const launchPaths = [
    ['skill entries', { skillEntries: { 'lar-shape': '/elsewhere/lar-shape/SKILL.md', 'lar-build': '/x/SKILL.md' } }],
    ['a CLI path', { bin: '/elsewhere/bin' }],
] as const;

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'lar-run-input-'));
    const records = agentWrites(await openWorkRecords(workRecordsPath(dir)));

    fixtures.push({ dir, records });

    const { workId } = records.create({ title: 'Input fixture', repository: 'test/repo', kind: 'build' });
    const revision = () => records.read(workId).revision;

    return { records, workId, revision };
}

for (const [name, paths] of launchPaths) {
    it(`snapshot-run input that supplies ${name} is refused`, async () => {
        const { records, workId, revision } = await fixture();

        expect(() =>
            records.snapshotRun(workId, revision(), {
                runId: 'run',
                kind: 'build',
                skills: [],
                packaged,
                ...paths,
            } as never),
        ).toThrow(/Invalid run record fields/);
        expect(records.runSettings(workId).runs).toEqual([]);
    });

    it(`start-role-run and finish-role-run input that supplies ${name} is refused`, async () => {
        const { records, workId, revision } = await fixture();

        records.snapshotRun(workId, revision(), { runId: 'run', kind: 'build', skills: [], packaged });

        expect(() =>
            records.startRoleRun(workId, revision(), {
                runId: 'run',
                executionId: 'role',
                role: 'planner',
                ...paths,
            } as never),
        ).toThrow(/Invalid run record fields/);
        expect(records.runSettings(workId).roleRuns).toEqual([]);

        records.startRoleRun(workId, revision(), { runId: 'run', executionId: 'role', role: 'planner' });

        expect(() =>
            records.finishRoleRun(workId, revision(), {
                executionId: 'role',
                result: 'completed',
                report: null,
                ...paths,
            } as never),
        ).toThrow(/Invalid run record fields/);
        expect(records.runSettings(workId).roleRuns[0]!.result).toBe('running');
        expect(records.runLaunches(workId, 'run').launches).toEqual([]);
    });
}

it('no agent command can record a launch', async () => {
    const { records, workId, revision } = await fixture();

    records.snapshotRun(workId, revision(), { runId: 'run', kind: 'build', skills: [], packaged });

    expect(() =>
        records.recordRunLaunch(workId, {
            runId: 'run',
            executionId: 'launch',
            skillEntries: {
                'lar-shape': '/elsewhere/lar-shape/SKILL.md',
                'lar-build': '/elsewhere/lar-build/SKILL.md',
            },
            bin: '/elsewhere/bin',
        }),
    ).toThrow(/Only the board/);
    expect(records.runLaunches(workId, 'run')).toEqual({ newRun: true, launches: [] });
});

it('a recorded launch is immutable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-run-launch-'));
    const records = await openWorkRecords(workRecordsPath(dir));

    fixtures.push({ dir, records });

    const { workId } = records.create({ title: 'Launch fixture', repository: 'test/repo', kind: 'build' });

    records.snapshotRun(workId, records.read(workId).revision, { runId: 'run', kind: 'build', skills: [], packaged });
    records.recordRunLaunch(workId, {
        runId: 'run',
        executionId: 'launch',
        skillEntries: { 'lar-shape': '/release/lar-shape/SKILL.md', 'lar-build': '/release/lar-build/SKILL.md' },
        bin: '/release/bin',
    });

    const db = new DatabaseSync(workRecordsPath(dir));

    try {
        expect(() => db.prepare("UPDATE run_launches SET content='{}' WHERE work_id=?").run(workId)).toThrow(
            /Run launches are immutable/,
        );
    } finally {
        db.close();
    }

    expect(records.runLaunches(workId, 'run').launches[0]!.bin).toBe('/release/bin');
});
