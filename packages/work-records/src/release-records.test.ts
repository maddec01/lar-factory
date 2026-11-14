import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vite-plus/test';

import { agentWrites } from './agent-writes.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const stores: WorkRecords[] = [];
const plan = {
    steps: [
        { id: 'stage', who: 'Agent', what: 'stage the exact merged bundle' },
        { id: 'activate', who: 'Pedro', what: 'activate the approved manifest' },
    ],
    outcomeCheck: 'Check composition, rejection and legacy behaviour.',
};
const fixture = async (kind: 'feature' | 'concept' = 'feature') => {
    const dir = mkdtempSync(join(tmpdir(), 'parent-release-'));

    dirs.push(dir);

    const path = join(dir, 'work-records.db');
    const records = await openWorkRecords(path);

    stores.push(records);

    const parent = records.create({ title: 'Deliver greeting', repository: 'sample/a', kind, status: 'In progress' });
    const id = parent.workId;
    const revision = () => records.read(id).revision;

    for (const repo of ['sample/a', 'sample/b', 'sample/c']) {
        const part = records.createPart({
            parentId: id,
            parentRevision: revision(),
            title: repo,
            repository: repo,
            kind: 'build',
            body: 'One build.',
            blockerIds: [],
        });

        records.setPullRequest(part.workId, part.revision, `${repo}#1`);
    }

    const merge = () => {
        for (const part of records.children(id))
            records.observe(part.workId, part.revision, { of: 'pr', state: 'merged' });
    };
    const set = () => records.setReleasePlan(id, revision(), plan);
    const step = (stepId: string) =>
        records.completeReleaseStep(id, revision(), stepId, 'Pedro', `${stepId} receipt SHA256`);
    const outcome = (result: 'passed' | 'failed') =>
        records.recordOutcomeCheck(id, revision(), result, 'Pedro', 'Actual post-activation checks.');

    return { records, id, revision, set, step, outcome, merge, dir, path };
};

afterEach(() => {
    for (const records of stores.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('completes repeat 4 parent from three observed merges, ordered release receipts and passing Outcome without its own PR', async () => {
    const f = await fixture();

    f.set();
    f.merge();
    expect(f.records.completion(f.id)).toMatchObject({
        complete: false,
        reasons: [
            expect.stringContaining('stage'),
            expect.stringContaining('activate'),
            expect.stringContaining('Outcome check pending'),
        ],
    });
    expect(() => f.step('activate')).toThrow(/preceding/);
    f.step('stage');
    expect(() => f.outcome('passed')).toThrow(/every release step/);
    f.step('activate');
    f.outcome('failed');
    expect(f.records.completion(f.id)).toEqual({
        complete: false,
        reasons: [expect.stringContaining('Outcome check failed')],
    });
    f.outcome('passed');
    expect(f.records.completion(f.id)).toEqual({ complete: true, reasons: [] });
    expect(f.records.read(f.id).pullRequest).toBeNull();
    f.records.setNeedsYou(f.id, f.revision(), 'Review the parent delivery evidence.');
    expect(f.records.completion(f.id)).toEqual({
        complete: false,
        reasons: ['Needs you: Review the parent delivery evidence.'],
    });
    f.records.clearNeedsYou(f.id, f.revision());
    expect(f.records.completion(f.id).complete).toBe(true);

    const reopened = await openWorkRecords(f.path);

    stores.push(reopened);
    expect(reopened.releasePlan(f.id)?.steps[1]?.done?.evidence).toContain('receipt');
    expect(reopened.completion(f.id).complete).toBe(true);
});

it('retains concept Fog and child completion independently of release evidence', async () => {
    const f = await fixture('concept');

    f.set();
    f.step('stage');
    f.step('activate');
    f.outcome('passed');
    expect(f.records.completion(f.id).reasons).toContain("Its Fog isn't gone.");
    expect(f.records.completion(f.id).reasons).toContainEqual(expect.stringContaining("isn't Done"));
    f.merge();
    f.records.setFogGone(f.id, f.revision(), true);
    expect(f.records.completion(f.id).complete).toBe(true);
});

it('refuses stale, malformed and out-of-order writes without losing evidence, and reopens a changed plan', async () => {
    const f = await fixture();
    const old = f.revision();

    f.set();

    const current = f.records.releasePlan(f.id);

    expect(() => f.records.setReleasePlan(f.id, old, plan)).toThrow(/parent changed/);
    for (const input of [
        {
            ...plan,
            steps: [
                { ...plan.steps[0], id: 'duplicate' },
                { ...plan.steps[1], id: 'duplicate' },
            ],
        },
        { ...plan, outcomeCheck: '' },
        { ...plan, unknown: true },
    ])
        expect(() => f.records.setReleasePlan(f.id, f.revision(), input)).toThrow(/Release|release/);
    expect(() => f.step('missing')).toThrow(/Unknown release step/);
    expect(f.records.releasePlan(f.id)).toEqual(current);
    f.merge();
    f.step('stage');
    f.step('activate');
    f.outcome('passed');

    const before = f.revision();

    f.set();
    expect(f.revision()).toBe(before);
    f.records.update(f.id, before, { status: 'Done' });
    f.records.recordFinished(f.id, f.revision());
    f.records.setReleasePlan(f.id, f.revision(), { ...plan, outcomeCheck: 'Check the amended outcome.' });
    expect(f.records.read(f.id)).toMatchObject({ status: 'In progress', finishedAt: null });
    expect(f.records.completion(f.id).complete).toBe(false);
    expect(() => f.records.writeRevision(f.id, old, ['releasePlan'])).toThrow(/releasePlan/);
});

it('keeps standalone completion unchanged and refuses release plans on a private build', async () => {
    const f = await fixture();
    const build = f.records.create({ title: 'Single', repository: 'sample/a', kind: 'build' });

    expect(f.records.completion(build.workId).reasons).toEqual(['It has no recorded PR.']);
    expect(() => f.records.setReleasePlan(build.workId, build.revision, plan)).toThrow(/parent/);

    const concept = f.records.create({ title: 'Empty', repository: 'sample/a', kind: 'concept' });

    f.records.setFogGone(concept.workId, concept.revision, true);
    expect(f.records.completion(concept.workId).reasons).toEqual(['No delivery planned.']);
});

it('keeps a part approval current for unrelated release progress and parent Outcome checks', async () => {
    const f = await fixture();
    const part = f.records.children(f.id)[0]!;

    f.set();

    const original = f.records.doubtPackage(part.workId);

    expect(original.releasePlan?.steps).toHaveLength(2);
    f.step('stage');
    expect(f.records.doubtPackage(part.workId).packageDigest).toBe(original.packageDigest);
    f.records.setReleasePlan(f.id, f.revision(), { ...plan, outcomeCheck: 'Changed required check.' });
    expect(f.records.doubtPackage(part.workId).packageDigest).toBe(original.packageDigest);
});

it('round trips parent release commands in an isolated data folder', async () => {
    const f = await fixture();
    const file = join(f.dir, 'plan.json');

    writeFileSync(file, JSON.stringify(plan));

    const cli = async (command: string, ...args: string[]) =>
        promisify(execFile)(
            process.execPath,
            [new URL('./cli.ts', import.meta.url).pathname, command, f.id, '--data-dir', f.dir, ...args],
            { env: { ...process.env, LAR_BOARD_PORT: '0' } },
        );

    await cli('set-release-plan', '--revision', String(f.revision()), '--file', file);
    await cli(
        'complete-release-step',
        '--revision',
        String(f.revision()),
        '--step',
        'stage',
        '--identity',
        'Builder',
        '--evidence',
        'Immutable manifest receipt.',
    );

    await expect(
        cli(
            'complete-release-step',
            '--revision',
            String(f.revision()),
            '--step',
            'activate',
            '--identity',
            'Pedro',
            '--evidence',
            'Agent pretending to be Pedro.',
        ),
    ).rejects.toThrow(/board/i);
    expect(f.records.releasePlan(f.id)?.steps[1]?.done).toBeNull();
    expect(() =>
        agentWrites(f.records).completeReleaseStep(f.id, f.revision(), 'activate', 'Builder', 'Receipt.'),
    ).toThrow(/board/i);

    const read = JSON.parse((await cli('release-plan')).stdout);

    expect(read.steps[0].done).toMatchObject({ by: 'Builder', evidence: 'Immutable manifest receipt.' });
    await expect(
        cli(
            'record-outcome-check',
            '--revision',
            String(f.revision()),
            '--result',
            'passed',
            '--identity',
            'Pedro',
            '--evidence',
            'Checks passed.',
        ),
    ).rejects.toThrow(/every release step/);
}, 15000);
