import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: WorkRecords[] = [];
const dirs: string[] = [];

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'concept-build-'));
    const path = join(dir, 'records.db');
    const records = await openWorkRecords(path);

    dirs.push(dir);
    opened.push(records);

    const group = records.create({ title: 'Concept', repository: 'example/a', kind: 'concept' });
    const build = records.createPart({
        parentId: group.workId,
        parentRevision: group.revision,
        title: 'First build',
        repository: 'example/b',
        kind: 'build',
        body: 'Exact brief',
        blockerIds: [],
    });
    const change = (id: string) => records.read(id).revision;
    const prepare = () => {
        records.setFogGone(group.workId, change(group.workId), true);
        records.setBody(group.workId, change(group.workId), 'map', 'Approved destination');
        records.update(build.workId, change(build.workId), { status: 'Ready' });
        records.recordGate(build.workId, change(build.workId), {
            briefDigest: records.gate(build.workId).briefDigest!,
            approvedBy: 'Pedro',
            evidence: 'Yes',
        });
    };

    return { records, path, group: group.workId, build: build.workId, change, prepare };
}

it('lists all preflight holds and saves nothing when a decision, pre-task, gate or Dependency is open', async () => {
    const { records, group, build, change } = await fixture();
    const decision = records.createPart({
        parentId: group,
        parentRevision: change(group),
        title: 'Pre-task: prove runtime',
        repository: 'example/a',
        kind: 'decision',
        body: 'Check runtime',
        blockerIds: [],
    });

    records.addDependency(group, { need: 'Accept external contract', owner: 'Other team' });

    const before = records.changes();
    const plan = records.conceptBuildPlan(group);

    for (const reason of ['Fog', 'map', 'approved gate', 'Queued', 'Pre-task', 'Other team'])
        expect(plan.holds.some((hold) => hold.reason.includes(reason))).toBe(true);
    expect(() => records.setConceptBuildRun(group, change(group), 'running')).toThrow('Fog');
    expect(records.conceptBuildPlan(group).run).toBeNull();
    expect(records.changes()).toBe(before);
    expect(records.launchIntents({ workId: build })).toEqual([]);
    expect(records.completion(decision.workId).complete).toBe(false);
});

it('saves prepared revisions, rejects stale starts and preserves active work through pause and reopen', async () => {
    const { records, path, group, build, change, prepare } = await fixture();

    prepare();

    const revision = change(group);
    const memberRevision = change(build);
    const run = records.setConceptBuildRun(group, revision, 'running').run!;

    expect(run).toMatchObject({ state: 'running', prepared: { [group]: revision, [build]: memberRevision } });
    expect(() => records.setConceptBuildRun(group, revision, 'running')).toThrow('changed');
    records.update(build, change(build), { status: 'In progress' });
    expect(records.conceptBuildPlan(group).run?.state).toBe('running');
    records.setConceptBuildRun(group, change(group), 'paused');

    const reopened = await openWorkRecords(path);

    opened.push(reopened);
    expect(reopened.conceptBuildPlan(group).run?.state).toBe('paused');
    expect(reopened.read(build).status).toBe('In progress');
    expect(reopened.launchIntents({})).toEqual([]);
});

it.each(['brief', 'gate', 'blocker', 'map'] as const)('pauses when the approved %s changes', async (what) => {
    const { records, group, build, change, prepare } = await fixture();

    prepare();
    records.setConceptBuildRun(group, change(group), 'running');

    if (what === 'brief') records.setBody(build, change(build), 'brief', 'Changed scope');

    if (what === 'gate') records.invalidateGate(build, change(build));

    if (what === 'map') records.setBody(group, change(group), 'map', 'Changed destination');

    if (what === 'blocker') {
        const other = records.create({ title: 'External prerequisite', repository: 'example/c', kind: 'build' });

        records.addBlocker(build, change(build), other.workId);
    }

    expect(records.conceptBuildPlan(group).run).toMatchObject({
        state: 'paused',
        reason: expect.stringContaining('changed'),
    });
});
