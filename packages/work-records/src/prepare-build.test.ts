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
    const dir = mkdtempSync(join(tmpdir(), 'prepare-build-'));
    const path = join(dir, 'work.db');
    const records = await openWorkRecords(path);
    const other = await openWorkRecords(path);

    dirs.push(dir);
    opened.push(records, other);

    const rev = (id: string) => records.read(id).revision;
    const ready = (title: string, repository = 'example/a') => {
        const work = records.create({ title, repository, kind: 'build', status: 'Ready' });

        records.setBody(work.workId, rev(work.workId), 'brief', `Exact ${title}`);
        records.recordGate(work.workId, rev(work.workId), {
            briefDigest: records.gate(work.workId).briefDigest!,
            approvedBy: 'Pedro',
            evidence: 'Yes',
        });

        return work.workId;
    };

    return { records, other, path, rev, ready };
}

const capacity = { limit: 1, atWorkIds: [] };

it('claims once across connections, counts an uncertain intent after reopen, and releases a definite failure', async () => {
    const { records, other, path, rev, ready } = await fixture();
    const first = ready('First');
    const second = ready('Second');
    const revision = rev(first);
    const intent = records.prepareBuild(first, revision, capacity).intent;

    expect(intent.buildInput).toMatchObject({
        brief: 'Exact First',
        revision,
        gate: { briefDigest: records.gate(first).briefDigest },
    });
    expect(() => other.prepareBuild(first, revision, capacity)).toThrow(/revision|launch/i);

    const reopened = await openWorkRecords(path);

    opened.push(reopened);
    expect(reopened.launchIntents({ workId: first })[0]?.buildInput).toEqual(intent.buildInput);
    expect(() => reopened.prepareBuild(second, rev(second), capacity)).toThrow('capacity');
    expect(records.launchIntents({ unresolved: true })).toHaveLength(1);
    records.resolveLaunchIntent(first, rev(first), intent.intentId, { failure: 'Confirmed absent' });
    expect(other.prepareBuild(second, rev(second), capacity).intent.workId).toBe(second);
});

it('permits independent worktrees in one repository and across repositories up to the same limit', async () => {
    const { records, other, rev, ready } = await fixture();
    const ids = [ready('A1'), ready('A2'), ready('B1', 'example/b')];

    for (const id of ids) other.prepareBuild(id, rev(id), { limit: 3, atWorkIds: [] });
    expect(records.launchIntents({ unresolved: true })).toHaveLength(3);

    const extra = ready('C1', 'example/c');

    expect(() => records.prepareBuild(extra, rev(extra), { limit: 3, atWorkIds: [] })).toThrow('capacity');
});

it('holds missing/stale gates, unmet blockers and a concept with an open pre-task without claiming', async () => {
    const { records, rev, ready } = await fixture();
    const build = ready('Consumer');
    const gate = records.gate(build).passing!.gateId;

    records.setBody(build, rev(build), 'brief', 'Changed');
    expect(records.read(build).status).toBe('Shaping');
    expect(() => records.prepareBuild(build, rev(build), capacity)).toThrow('Only Ready builds');
    records.recordGate(build, rev(build), {
        briefDigest: records.gate(build).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes',
    });
    records.update(build, rev(build), { status: 'Ready' });
    expect(() => records.prepareBuild(build, rev(build), { ...capacity, expectedGateId: gate })).toThrow('changed');

    const blocker = ready('Contract');

    records.addBlocker(build, rev(build), blocker);
    expect(() => records.prepareBuild(build, rev(build), capacity)).toThrow('blockers');
    records.removeBlocker(build, rev(build), blocker);

    const parent = records.create({ title: 'Unrefined concept', repository: 'example/a', kind: 'concept' });

    records.setParent(build, rev(build), parent.workId);
    expect(() => records.prepareBuild(build, rev(build), capacity)).toThrow('Fog');
    expect(records.launchIntents({})).toEqual([]);
});

it('rejects a Pause that races preparation, and permanently records scope-change pauses', async () => {
    const { records, other, rev, ready } = await fixture();
    const group = records.create({ title: 'Concept', repository: 'example/a', kind: 'concept' }).workId;
    const build = ready('Part');

    records.setParent(build, rev(build), group);
    records.setFogGone(group, rev(group), true);
    records.setBody(group, rev(group), 'map', 'Approved destination');
    records.setConceptBuildRun(group, rev(group), 'running');

    const source = { ...capacity, conceptId: group };

    records.buildReadiness(build, source);
    other.setConceptBuildRun(group, rev(group), 'paused');
    expect(() => records.prepareBuild(build, rev(build), source)).toThrow('paused');
    records.setConceptBuildRun(group, rev(group), 'running');
    records.setBody(group, rev(group), 'map', 'Changed destination');
    records.reconcileConceptBuildRuns();
    records.setBody(group, rev(group), 'map', 'Approved destination');
    expect(records.conceptBuildPlan(group).run?.state).toBe('paused');
    expect(records.launchIntents({})).toEqual([]);
});

it('a PR waiting for review releases active capacity, while working again and unresolved launches still count', async () => {
    const { records, rev, ready } = await fixture();
    const a = ready('A');
    const b = ready('B');
    const c = ready('C');
    const intent = records.prepareBuild(a, rev(a), capacity).intent;

    records.resolveLaunchIntent(a, rev(a), intent.intentId, { threadId: 'build-a' });
    expect(() => records.prepareBuild(b, rev(b), capacity)).toThrow('capacity');
    records.update(a, rev(a), { status: 'Ready to merge' });
    records.prepareBuild(b, rev(b), capacity);
    expect(() => records.prepareBuild(c, rev(c), { limit: 2, atWorkIds: [a] })).toThrow('capacity');
    expect(records.launchIntents({ workId: a })[0]?.buildInput?.brief).toBe('Exact A');
});

it('keeps explicit recovery available at later build stages through the shared capacity path', async () => {
    const { records, rev, ready } = await fixture();
    const id = ready('Recover');

    for (const status of ['Ready to merge', 'Review', 'Verify'] as const) {
        records.update(id, rev(id), { status });
        expect(records.buildReadiness(id, { ...capacity, recovery: true }).brief).toBe('Exact Recover');
        expect(() => records.buildReadiness(id, capacity)).toThrow('Only Ready');
    }
});

it('a linked parent without its own build does not consume a shared capacity slot', async () => {
    const { records, rev, ready } = await fixture();
    const parent = records.create({
        title: 'Linked delivery',
        repository: 'example/a',
        kind: 'feature',
        status: 'In progress',
    });
    const child = records.createPart({
        parentId: parent.workId,
        parentRevision: rev(parent.workId),
        title: 'First child',
        repository: 'example/a',
        kind: 'build',
        body: 'Exact first child',
        blockerIds: [],
    }).workId;

    records.recordGate(child, rev(child), {
        briefDigest: records.gate(child).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Yes',
    });
    records.update(child, rev(child), { status: 'Ready' });
    expect(records.prepareBuild(child, rev(child), capacity).intent.workId).toBe(child);

    const other = ready('Other');

    expect(() => records.prepareBuild(other, rev(other), capacity)).toThrow(/capacity/);
});
