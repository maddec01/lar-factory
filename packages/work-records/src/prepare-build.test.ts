import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
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
            approvedBy: 'User',
            evidence: 'Yes',
        });

        return work.workId;
    };

    return { records, other, path, rev, ready };
}

const capacity = { limit: 1 };

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

it('holds missing/stale gates, unmet blockers and a concept with an open pre-task without claiming', async () => {
    const { records, rev, ready } = await fixture();
    const build = ready('Consumer');
    const gate = records.gate(build).passing!.gateId;

    records.setBody(build, rev(build), 'brief', 'Changed');
    expect(records.read(build).status).toBe('Shaping');
    expect(() => records.prepareBuild(build, rev(build), capacity)).toThrow('Only Ready builds');
    records.recordGate(build, rev(build), {
        briefDigest: records.gate(build).briefDigest!,
        approvedBy: 'User',
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

it('starts a build whose brief names the same files as another active item without a blocker between them', async () => {
    const { records, rev, ready } = await fixture();
    const build = ready('Links');
    const other = ready('Other links');

    records.setBody(other, rev(other), 'brief', 'Files: `src/links.ts`');
    records.setBody(build, rev(build), 'brief', 'Files: `src/links.ts`');
    records.recordGate(build, rev(build), {
        briefDigest: records.gate(build).briefDigest!,
        approvedBy: 'User',
        evidence: 'Yes',
    });
    records.update(build, rev(build), { status: 'Ready' });

    expect(records.prepareBuild(build, rev(build), capacity).intent.workId).toBe(build);
});

it('starts a build sharing a Contracts name with another active build when neither declares Produces', async () => {
    const { records, rev, ready } = await fixture();
    const build = ready('Greeting reader');
    const other = ready('Greeting writer');
    const brief = (id: string, text: string) => {
        records.setBody(id, rev(id), 'brief', text);
        records.recordGate(id, rev(id), {
            briefDigest: records.gate(id).briefDigest!,
            approvedBy: 'User',
            evidence: 'Yes',
        });
        records.update(id, rev(id), { status: 'Ready' });
    };

    records.setBody(other, rev(other), 'brief', 'Contracts: `greeting-v1`');
    brief(build, 'Contracts: `greeting-v1`');

    expect(records.prepareBuild(build, rev(build), capacity).intent.workId).toBe(build);
});

it('refuses a Consumes line that resolves to no build and a consumer without a blocker path to its producer', async () => {
    const { records, rev, ready } = await fixture();
    const build = ready('Greeting reader');
    const brief = (text: string) => {
        records.setBody(build, rev(build), 'brief', text);
        records.recordGate(build, rev(build), {
            briefDigest: records.gate(build).briefDigest!,
            approvedBy: 'User',
            evidence: 'Yes',
        });
        records.update(build, rev(build), { status: 'Ready' });
    };

    ready('Greeting writer');
    brief('Consumes: `Missing writer`');
    expect(() => records.prepareBuild(build, rev(build), capacity)).toThrow('contract sources');
    brief('Consumes: `Greeting writer`');
    expect(() => records.prepareBuild(build, rev(build), capacity)).toThrow('consumer blockers');
    brief('Consumes: `Missing writer`\nNo ordering needed: `Missing writer`: reads a fixture copy.');
    expect(records.prepareBuild(build, rev(build), capacity).intent.workId).toBe(build);
});

it('S08 F01: user waits retain the original slot across answers, amendments, handoff and reopen', async () => {
    const { records, other, rev, ready } = await fixture();
    const a = ready('SA');
    const b = ready('S08 R02 GB — greeting build');
    const intent = records.prepareBuild(a, rev(a), capacity).intent;

    records.resolveLaunchIntent(a, rev(a), intent.intentId, { threadId: 'sa-owner' });
    for (const status of ['Needs you', 'Shaping', 'Ready to merge'] as const) {
        records.update(a, rev(a), { status });
        expect(() => other.prepareBuild(b, rev(b), capacity)).toThrow(/capacity/);
        expect(() => other.buildReadiness(b, { ...capacity, recovery: true })).toThrow(/capacity/);
    }
    records.resumeFromUser(a, rev(a), 'In progress');
    expect(() => other.prepareBuild(b, rev(b), capacity)).toThrow(/capacity/);
    records.update(a, rev(a), { status: 'Done' });
    expect(() => other.prepareBuild(b, rev(b), capacity)).toThrow(/capacity/);
    records.setAside(a, rev(a));
    expect(other.prepareBuild(b, rev(b), capacity).intent.workId).toBe(b);
});

it('S08 F04: exact T3 wait observation survives a new connection and later scope writes', async () => {
    const { records, other, rev, ready } = await fixture();
    const id = ready('SA scope');

    records.waitForUser(id, rev(id), 'Gold or amber?');
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'scope-q' });
    records.setBody(id, rev(id), 'brief', 'Gold scope saved after the exact T3 answer');
    other.reconcileUserWait(id, { threadId: 'owner' });
    expect(records.read(id)).toMatchObject({ needsYou: null, status: 'Shaping' });
    records.waitForUser(id, rev(id), 'New question still needs an answer');
    other.reconcileUserWait(id, { threadId: 'owner' });
    expect(records.read(id).needsYou).toBe('New question still needs an answer');
});

it('User manual starts record free claims and overrides; automatic claims wait until below the limit', async () => {
    const { records, other, rev, ready } = await fixture();
    const a = ready('Manual first');
    const b = ready('Manual override');
    const c = ready('Automatic next');
    const first = records.prepareBuild(a, rev(a), { ...capacity, manual: true }).intent;

    expect(first.buildInput?.capacity).toMatchObject({
        source: 'manual',
        occupied: 0,
        limit: 1,
        manualOverride: false,
    });
    records.resolveLaunchIntent(a, rev(a), first.intentId, { threadId: 'manual-a' });

    const override = other.prepareBuild(b, rev(b), { ...capacity, manual: true }).intent;

    expect(override.buildInput?.capacity).toMatchObject({
        source: 'manual',
        occupied: 1,
        limit: 1,
        manualOverride: true,
    });
    records.resolveLaunchIntent(b, rev(b), override.intentId, { threadId: 'manual-b' });
    expect(records.launchIntents({ workId: b })[0]!.buildInput?.capacity?.manualOverride).toBe(true);
    expect(() => other.prepareBuild(c, rev(c), { ...capacity, automatic: true })).toThrow(/capacity/);
    expect(other.buildReadiness(a, { ...capacity, recovery: true }).capacity?.manualOverride).toBe(false);
    records.setAside(b, rev(b));
    expect(() => other.prepareBuild(c, rev(c), { ...capacity, automatic: true })).toThrow(/capacity/);
    records.setAside(a, rev(a));
    expect(other.prepareBuild(c, rev(c), { ...capacity, automatic: true }).intent.buildInput?.capacity).toMatchObject({
        source: 'automatic',
        manualOverride: false,
        occupied: 0,
    });
});

it('a recorded open List PR without a factory start never consumes a claim', async () => {
    const { records, rev, ready } = await fixture();
    const old = records.create({
        title: 'Old tracker work',
        repository: 'example/a',
        kind: 'build',
        status: 'List',
    }).workId;

    records.setPullRequest(old, rev(old), 'example/a#4');
    records.observe(old, rev(old), { of: 'pr', state: 'open' });

    const id = ready('Fresh');

    expect(records.prepareBuild(id, rev(id), { ...capacity, manual: true }).intent.buildInput?.capacity).toEqual({
        source: 'manual',
        limit: 1,
        occupied: 0,
        manualOverride: false,
    });
});

it('a merged factory PR releases its slot even before status reconciliation', async () => {
    const { records, rev, ready } = await fixture();
    const old = ready('Old factory build');
    const intent = records.prepareBuild(old, rev(old), capacity).intent;

    records.resolveLaunchIntent(old, rev(old), intent.intentId, { threadId: 'old-builder' });
    records.setPullRequest(old, rev(old), 'example/a#4');
    records.observe(old, rev(old), { of: 'pr', state: 'merged' });

    const id = ready('Fresh');

    expect(records.prepareBuild(id, rev(id), capacity).intent.buildInput?.capacity?.occupied).toBe(0);
});

it('S05-F2-001: board actions cannot create independent owner notices', async () => {
    const { records } = await fixture();
    const id = records.create({ title: 'Release', repository: 'fake/app', kind: 'concept' }).workId;
    const at = () => records.read(id).revision;

    records.setReleasePlan(id, at(), {
        steps: [{ id: 'approve-joint-activation', who: 'User', what: 'Approve activation' }],
        outcomeCheck: 'Composition',
    });
    for (const reason of [
        'Release step approve-joint-activation awaits the user in the board.',
        'Please approve the brief gate in the board.',
    ]) {
        expect(() => records.setNeedsYou(id, at(), reason)).toThrow(/board|release step/i);
        expect(() => records.waitForUser(id, at(), reason)).toThrow(/board|release step/i);
        expect(records.read(id).needsYou).toBeNull();
    }
    records.setNeedsYou(id, at(), 'Which region should Release step approve-joint-activation use?');
    records.waitForUser(id, at(), 'Which activation region should we use?');
    expect(records.read(id).needsYou).toContain('Which activation region');
    records.resumeFromUser(id, at(), 'Shaping');
    records.completeReleaseStep(id, at(), 'approve-joint-activation', 'User', 'Exact manifest approved.');
    expect(() => records.waitForUser(id, at(), 'No user activation receipt is recorded.')).toThrow(
        /release step approve-joint-activation/,
    );
});

it('a build whose PR is open frees its slot and restarts even when the limit is full', async () => {
    const { records, other, rev, ready } = await fixture();
    const start = (id: string, preparation = capacity) => {
        const intent = records.prepareBuild(id, rev(id), preparation).intent;

        records.resolveLaunchIntent(id, rev(id), intent.intentId, { threadId: `owner-${intent.intentId}` });
    };
    const a = ready('Building A');
    const b = ready('Building B');
    const next = ready('Next');
    const limit = { limit: 2 };

    start(a, limit);
    start(b, limit);
    expect(() => other.prepareBuild(next, rev(next), limit)).toThrow(/capacity/);

    records.setPullRequest(a, rev(a), 'example/a#9');
    records.observe(a, rev(a), { of: 'pr', state: 'open' });
    start(next, limit);

    records.update(a, rev(a), { status: 'Review' });
    expect(other.buildReadiness(a, { ...limit, recovery: true }).capacity).toMatchObject({ manualOverride: false });
});

it('new builds fold human Verify into PR review, while recovery keeps legacy Verify', async () => {
    const { records, path, rev, ready } = await fixture();
    const id = ready('New PR review');

    records.setBody(
        id,
        rev(id),
        'brief',
        completeBrief('## What\nDeliver the greeting.\n## Verify\nyes: Judge the greeting layout.'),
    );
    records.recordGate(id, rev(id), {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'Human',
        evidence: 'Approved human Test steps',
    });
    records.update(id, rev(id), { status: 'Ready' });
    expect(records.verification(id).required).toBe(true);
    records.prepareBuild(id, rev(id), capacity);
    expect(records.verification(id)).toMatchObject({ required: false, prReview: true });
    records.recordGate(id, rev(id), {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'Human',
        evidence: 'Retained approval',
    });
    expect(records.verification(id).required).toBe(false);
    records.update(id, rev(id), { status: 'Ready to merge' });
    expect(() => records.update(id, rev(id), { status: 'Verify' })).toThrow('PR review');

    const reopened = await openWorkRecords(path);

    opened.push(reopened);
    expect(reopened.verification(id)).toMatchObject({ required: false, prReview: true });

    const legacy = ready('Legacy Verify');

    records.update(legacy, rev(legacy), { status: 'Verify' });
    records.setPullRequest(legacy, rev(legacy), 'example/a#4');
    records.prepareBuild(legacy, rev(legacy), { ...capacity, recovery: true });
    expect(records.verification(legacy)).toMatchObject({ required: true, prReview: false });
    expect(() => records.update(legacy, rev(legacy), { status: 'Ready to merge' })).toThrow('Pass Verify');
});
