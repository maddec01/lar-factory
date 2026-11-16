import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { agentWrites } from './agent-writes.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'lar-agent-concepts-'));

    dirs.push(dir);

    const path = join(dir, 'work.db');
    const records = await openWorkRecords(path);
    const other = await openWorkRecords(path);

    opened.push(records, other);

    const create = (title: string, kind: 'build' | 'concept' | 'decision' = 'build') =>
        records.create({ title, kind, repository: 'example/repo' });
    const revision = (id: string) => records.read(id).revision;
    const body = (id: string, name: 'brief' | 'answer' | 'domain-drafts' | 'map', text: string) =>
        records.setBody(id, revision(id), name, text);
    const note = (id: string) => other.setNeedsYou(id, revision(id), 'Concurrent note');

    return { records, other, agent: agentWrites(records), create, revision, body, note };
}

it('reapplies every set-aside revision and appends a hold to a concurrent note', async () => {
    const f = await fixture();
    const source = f.create('Retire');
    const replacement = f.create('Replacement');
    const dependent = f.create('Dependent');
    const held = f.create('Held');

    for (const record of [dependent, held]) f.records.addBlocker(record.workId, record.revision, source.workId);

    const revision = f.revision(source.workId);
    const plan: Parameters<WorkRecords['setAside']>[2] = [
        {
            workId: dependent.workId,
            revision: f.revision(dependent.workId),
            action: 'replace',
            blockerId: replacement.workId,
            blockerRevision: replacement.revision,
            reason: 'Use the replacement',
        },
        { workId: held.workId, revision: f.revision(held.workId), action: 'hold', reason: 'Reconcile active work' },
    ];

    for (const record of [source, replacement, dependent, held]) f.note(record.workId);
    expect(() => f.records.setAside(source.workId, revision, plan)).toThrow(/read it again/);
    expect(f.agent.setAside(source.workId, revision, plan).setAside).toBe(true);
    expect(f.records.blockers(dependent.workId).map((r) => r.workId)).toEqual([replacement.workId]);
    expect(f.records.read(held.workId).needsYou).toContain('Concurrent note\nSet-aside');
    expect(plan[0]!.revision).toBe(2);
});

it('refuses a set-aside plan after a conflicting dependent change without partial writes', async () => {
    const f = await fixture();
    const source = f.create('Retire');
    const replacement = f.create('Replacement');
    const dependent = f.create('Dependent');

    f.records.addBlocker(dependent.workId, 1, source.workId);

    const revision = f.revision(source.workId);
    const plan: Parameters<WorkRecords['setAside']>[2] = [
        {
            workId: dependent.workId,
            revision: f.revision(dependent.workId),
            action: 'replace',
            blockerId: replacement.workId,
            blockerRevision: replacement.revision,
            reason: 'Replace',
        },
    ];

    f.other.setBuildPhase(dependent.workId, f.revision(dependent.workId), 'implement');

    const before = f.records.list({});

    expect(() => f.agent.setAside(source.workId, revision, plan)).toThrow(/conflicting fields:/);
    expect(f.records.list({})).toEqual(before);
    expect(f.records.blockers(dependent.workId).map((r) => r.workId)).toEqual([source.workId]);
});

async function mergeFixture() {
    const f = await fixture();
    const parent = f.create('Concept', 'concept');
    const source = f.create('Absorbed');
    const target = f.create('Survivor');
    const dependent = f.create('Dependent');

    for (const record of [source, target, dependent]) f.records.setParent(record.workId, 1, parent.workId);
    f.body(source.workId, 'brief', 'Source acceptance');
    f.body(target.workId, 'brief', 'Target acceptance');
    f.records.addBlocker(dependent.workId, f.revision(dependent.workId), source.workId);

    const made = f.records.addDependency(source.workId, {
        need: 'External API',
        owner: 'Other team',
        ticket: 'example/other#1',
    });
    const dependency = f.records.addDependencyBlock(made.dependencyId, made.revision, source.workId);
    const revision = f.revision(source.workId);
    const input = {
        into: target.workId,
        revisions: Object.fromEntries(f.records.list({}).map((r) => [r.workId, r.revision])),
        dependencyRevisions: { [dependency.dependencyId]: dependency.revision },
    };

    return { ...f, parent, source, target, dependent, dependency, sourceRevision: revision, input };
}

it('merges builds after disjoint endpoint and Dependency observations, preserving every note', async () => {
    const f = await mergeFixture();

    for (const record of [f.source, f.target, f.dependent]) f.note(record.workId);
    f.other.observeDependency(f.dependency.dependencyId, f.dependency.revision, {
        subject: 'example/other#1',
        kind: 'open',
    });
    expect(() => f.records.mergeBuild(f.source.workId, f.sourceRevision, f.input)).toThrow(/read it again/);

    const merged = f.agent.mergeBuild(f.source.workId, f.sourceRevision, f.input);

    expect(merged.source.supersededBy).toBe(f.target.workId);
    expect(f.records.body(f.target.workId, 'brief')).toContain('Source acceptance');
    expect(f.records.blockers(f.dependent.workId).map((r) => r.workId)).toEqual([f.target.workId]);
    expect(f.records.unmetDependencies(f.target.workId)[0]?.dependencyId).toBe(f.dependency.dependencyId);
    expect(f.records.dependency(f.dependency.dependencyId).observations).toHaveLength(1);
    for (const record of [f.source, f.target, f.dependent])
        expect(f.records.read(record.workId).needsYou).toBe('Concurrent note');
});

it('refuses a merge after a conflicting target brief change', async () => {
    const f = await mergeFixture();

    f.body(f.target.workId, 'brief', 'New target scope');

    const before = f.records.list({});

    expect(() => f.agent.mergeBuild(f.source.workId, f.sourceRevision, f.input)).toThrow(/conflicting fields:/);
    expect(f.records.list({})).toEqual(before);
    expect(f.records.read(f.source.workId).setAside).toBe(false);
});

async function answerFixture() {
    const f = await fixture();
    const parent = f.create('Concept', 'concept');
    const source = f.create('Old decision', 'decision');
    const replacement = f.create('Replacement', 'decision');
    const affected = f.create('Affected');

    for (const record of [source, replacement, affected]) f.records.setParent(record.workId, 1, parent.workId);
    f.body(source.workId, 'answer', 'Old answer');
    f.body(affected.workId, 'brief', 'Approved scope');
    f.records.recordGate(affected.workId, f.revision(affected.workId), {
        briefDigest: f.records.gate(affected.workId).briefDigest!,
        approvedBy: 'user',
        evidence: 'Approved',
    });
    f.body(replacement.workId, 'answer', 'New answer');

    const input = {
        answerRevision: 1,
        by: {
            kind: 'decision' as const,
            workId: replacement.workId,
            revision: f.revision(replacement.workId),
            answerRevision: 1,
        },
        affected: [{ workId: affected.workId, revision: f.revision(affected.workId) }],
    };

    return { ...f, parent, source, replacement, affected, input, sourceRevision: f.revision(source.workId) };
}

it('supersedes by an exact decision after unrelated changes to every record', async () => {
    const f = await answerFixture();

    for (const record of [f.source, f.replacement, f.affected]) f.note(record.workId);
    expect(() => f.records.supersedeAnswer(f.source.workId, f.sourceRevision, f.input)).toThrow(/read it again/);
    f.agent.supersedeAnswer(f.source.workId, f.sourceRevision, f.input);
    expect(f.records.decisionAnswer(f.source.workId).replacement?.text).toBe('New answer');
    expect(f.records.gate(f.affected.workId).passing).toBeNull();
    expect(f.records.answerHistory(f.source.workId)[0]?.text).toBe('Old answer');
    for (const record of [f.source, f.replacement, f.affected])
        expect(f.records.read(record.workId).needsYou).toBe('Concurrent note');
});

it('versions an answer after an unrelated note but refuses overwriting a superseded version', async () => {
    const f = await answerFixture();

    f.note(f.source.workId);
    f.agent.setBody(f.source.workId, f.sourceRevision, 'answer', 'Reviewed revision');
    expect(f.records.answerHistory(f.source.workId).map((v) => v.revision)).toEqual([1, 2]);
    expect(f.records.read(f.source.workId).needsYou).toBe('Concurrent note');

    const revision = f.revision(f.source.workId);

    f.records.supersedeAnswer(f.source.workId, revision, { ...f.input, answerRevision: 2 });
    expect(() => f.agent.setBody(f.source.workId, revision, 'answer', 'Stale edit')).toThrow(/answerState/);
    expect(f.records.answerHistory(f.source.workId)).toHaveLength(2);
});

it('refuses a stale map after a child’s answer changes', async () => {
    const f = await answerFixture();

    f.body(f.source.workId, 'domain-drafts', 'none');
    f.body(f.parent.workId, 'map', 'Reviewed map');

    const revision = f.revision(f.parent.workId);

    f.note(f.parent.workId);
    f.agent.setBody(f.parent.workId, revision, 'map', 'Reviewed map with a note');

    const beforeAnswer = f.revision(f.parent.workId);
    const beforeFinish = f.revision(f.source.workId);

    f.body(f.source.workId, 'answer', 'Unreviewed child change');
    expect(() => f.agent.setBody(f.parent.workId, beforeAnswer, 'map', 'Stale incorporation')).toThrow(
        /decisionAnswers/,
    );
    expect(f.records.body(f.parent.workId, 'map')).toBe('Reviewed map with a note');
    expect(() => f.agent.recordFinished(f.source.workId, beforeFinish)).toThrow(/answerState|body.domain-drafts/);
});
