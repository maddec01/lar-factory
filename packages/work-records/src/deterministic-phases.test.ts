import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'lar-build-phases-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    const { workId } = records.create({ title: 'Build', repository: 'test/repo', kind: 'build', status: 'Ready' });
    const revision = () => records.read(workId).revision;
    const launch = (recovery?: { branch: string; reset: boolean }) => {
        const { intent } = records.recordLaunchIntent(workId, revision(), 'build', recovery);

        return records.resolveLaunchIntent(workId, revision(), intent.intentId, { threadId: intent.intentId }).record;
    };

    records.snapshotRun(workId, revision(), {
        runId: 'build',
        kind: 'build',
        skills: [],
        packaged: {
            version: 'test',
            reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
        projectDefault: { instanceId: 'codex', model: 'test', options: [{ id: 'reasoningEffort', value: 'high' }] },
    });

    return { records, workId, revision, launch };
}

it('records plan with a successful build start, preserves a resumed phase and resets a replacement to plan', async () => {
    const { records, workId, revision, launch } = await fixture();
    const started = launch();

    expect(started).toMatchObject({ status: 'In progress', buildPhase: 'plan' });
    records.setBuildPhase(workId, revision(), 'implement');
    expect(launch()).toMatchObject({ status: 'In progress', buildPhase: 'implement' });
    expect(launch({ branch: 'replacement', reset: true })).toMatchObject({ buildPhase: 'plan' });
});

it('a refused launch records no phase', async () => {
    const { records, workId, revision } = await fixture();
    const { intent } = records.recordLaunchIntent(workId, revision(), 'build');

    expect(
        records.resolveLaunchIntent(workId, revision(), intent.intentId, { failure: 'Refused' }).record,
    ).toMatchObject({ status: 'Ready', buildPhase: null });
});

it.each([
    ['planner', 'plan'],
    ['implementer', 'implement'],
    ['domain-docs', 'domain-docs'],
    ['checks', 'full-checks'],
    ['reviewer:code', 'review'],
    ['approver', 'approve'],
    ['ci-fixer', 'checks'],
] as const)('records the %s phase in the role launch transaction', async (role, phase) => {
    const { records, workId, revision, launch } = await fixture();

    launch();

    const before = revision();
    const attempt = records.startRoleRun(workId, before, { runId: 'build', executionId: 'role', role });

    expect(records.read(workId)).toMatchObject({
        buildPhase: phase,
        revision: before + 1,
        ...(phase === 'review' ? { status: 'Review' } : {}),
    });
    records.setBuildPhase(workId, revision(), 'checks');

    const repeatedAt = revision();

    expect(records.startRoleRun(workId, repeatedAt, { runId: 'build', executionId: 'role', role })).toEqual(attempt);
    expect(records.read(workId)).toMatchObject({ buildPhase: 'checks', revision: repeatedAt });
});

it.each([
    ['planner', 'implement'],
    ['approver', 'checks'],
] as const)(
    'a successful %s finish records the next step; failures and retries do not advance it',
    async (role, phase) => {
        const { records, workId, revision, launch } = await fixture();

        launch();
        records.startRoleRun(workId, revision(), { runId: 'build', executionId: 'failed', role });

        const beforeFailure = records.read(workId).buildPhase;

        records.finishRoleRun(workId, revision(), {
            executionId: 'failed',
            report: null,
            result: 'failed',
            failure: 'Stopped',
        });
        expect(records.read(workId).buildPhase).toBe(beforeFailure);
        records.startRoleRun(workId, revision(), { runId: 'build', executionId: 'passed', role });

        const before = revision();

        records.finishRoleRun(workId, before, { executionId: 'passed', report: null, result: 'completed' });
        expect(records.read(workId)).toMatchObject({ buildPhase: phase, revision: before + 1 });

        const endedAt = revision();

        records.finishRoleRun(workId, endedAt, { executionId: 'passed', report: null, result: 'completed' });
        expect(revision()).toBe(endedAt);
    },
);

it.each(['phase-first', 'status-first'])(
    'Review phase and status change together through compatibility writes (%s)',
    async (order) => {
        const { records, workId, revision, launch } = await fixture();

        launch();
        records.setBuildPhase(workId, revision(), 'full-checks');

        const before = revision();

        if (order === 'phase-first') records.setBuildPhase(workId, before, 'review');
        else records.update(workId, before, { status: 'Review' });

        expect(records.read(workId)).toMatchObject({ status: 'Review', buildPhase: 'review', revision: before + 1 });
    },
);

it('records plan before dispatch, so an agent can never implement before plan was recorded', async () => {
    const { records, workId, revision } = await fixture();
    const { intent } = records.recordLaunchIntent(workId, revision(), 'build');
    const request = {
        projectId: 'p',
        title: 'Build',
        text: 'Build',
        selection: { instanceId: 'codex', model: 'test' },
        workspace: { type: 'root' as const },
        runtimeMode: 'full-access',
    };

    expect(records.saveLaunchRequest(workId, revision(), intent.intentId, request).buildPhase).toBe('plan');
    records.setBuildPhase(workId, revision(), 'implement');
    expect(
        records.resolveLaunchIntent(workId, revision(), intent.intentId, { threadId: 'fast-builder' }).record
            .buildPhase,
    ).toBe('implement');
});
