import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { agentWrites } from './agent-writes.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];

afterEach(() => {
    vi.restoreAllMocks();
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

it('retitles after unrelated writes, retaining projection history and refusing an intervening title', async () => {
    const f = await fixture();
    const record = f.create('Original');
    const ticketed = f.records.attachTicket(record.workId, record.revision, 'example/repo#1');

    f.note(record.workId);
    f.agent.retitle(record.workId, ticketed.revision, 'Reviewed title');
    expect(f.records.titleProjections()).toMatchObject([{ previous: 'Original', title: 'Reviewed title' }]);
    expect(f.records.read(record.workId).needsYou).toBe('Concurrent note');
    expect(() => f.agent.retitle(record.workId, ticketed.revision, 'Stale title')).toThrow(/conflicting fields: title/);
    expect(f.records.titleHistory(record.workId)).toHaveLength(1);
});

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

it.each(['source', 'dependent', 'replacement', 'new dependent'] as const)(
    'refuses a set-aside plan after a conflicting %s change without partial writes',
    async (change) => {
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

        if (change === 'source') f.other.setAside(source.workId, revision, [{ ...plan[0]!, action: 'hold' }]);

        if (change === 'dependent') f.other.setBuildPhase(dependent.workId, f.revision(dependent.workId), 'implement');

        if (change === 'replacement') f.other.setAside(replacement.workId, replacement.revision);

        if (change === 'new dependent') f.records.addBlocker(f.create('New dependent').workId, 1, source.workId);

        const before = f.records.list({});

        expect(() => f.agent.setAside(source.workId, revision, plan)).toThrow(/conflicting fields:/);
        expect(f.records.list({})).toEqual(before);
        expect(f.records.blockers(dependent.workId).map((r) => r.workId)).toEqual([source.workId]);
    },
);

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

it.each(['source brief', 'target brief', 'dependent phase', 'Dependency blocks'])(
    'refuses a merge after a conflicting %s change',
    async (change) => {
        const f = await mergeFixture();

        if (change === 'source brief') f.body(f.source.workId, 'brief', 'New source scope');

        if (change === 'target brief') f.body(f.target.workId, 'brief', 'New target scope');

        if (change === 'dependent phase')
            f.other.setBuildPhase(f.dependent.workId, f.revision(f.dependent.workId), 'implement');

        if (change === 'Dependency blocks') {
            const extra = f.create('Extra');

            f.records.setParent(extra.workId, 1, f.parent.workId);
            f.other.addDependencyBlock(f.dependency.dependencyId, f.dependency.revision, extra.workId);
        }

        const before = f.records.list({});

        expect(() => f.agent.mergeBuild(f.source.workId, f.sourceRevision, f.input)).toThrow(/conflicting fields:/);
        expect(f.records.list({})).toEqual(before);
        expect(f.records.read(f.source.workId).setAside).toBe(false);
    },
);

async function answerFixture(kind: 'decision' | 'gate' = 'decision') {
    const f = await fixture();
    const parent = f.create('Concept', 'concept');
    const source = f.create('Old decision', 'decision');
    const replacement = f.create('Replacement', kind === 'decision' ? 'decision' : 'build');
    const affected = f.create('Affected');

    for (const record of [source, replacement, affected]) f.records.setParent(record.workId, 1, parent.workId);
    f.body(source.workId, 'answer', 'Old answer');
    f.body(affected.workId, 'brief', 'Approved scope');

    const gate = (id: string) =>
        f.records.recordGate(id, f.revision(id), {
            briefDigest: f.records.gate(id).briefDigest!,
            approvedBy: 'user',
            evidence: 'Approved',
        });

    gate(affected.workId);

    if (kind === 'decision') f.body(replacement.workId, 'answer', 'New answer');
    else {
        f.body(replacement.workId, 'brief', 'New contract');
        gate(replacement.workId);
    }

    const by =
        kind === 'decision'
            ? { kind, workId: replacement.workId, revision: f.revision(replacement.workId), answerRevision: 1 }
            : {
                  kind,
                  workId: replacement.workId,
                  revision: f.revision(replacement.workId),
                  gateId: f.records.gate(replacement.workId).passing!.gateId,
              };
    const input = {
        answerRevision: 1,
        by,
        affected: [{ workId: affected.workId, revision: f.revision(affected.workId) }],
    };

    return { ...f, parent, source, replacement, affected, input, sourceRevision: f.revision(source.workId) };
}

it.each(['decision', 'gate'] as const)(
    'supersedes by an exact %s after unrelated changes to every record',
    async (kind) => {
        const f = await answerFixture(kind);

        for (const record of [f.source, f.replacement, f.affected]) f.note(record.workId);
        expect(() => f.records.supersedeAnswer(f.source.workId, f.sourceRevision, f.input)).toThrow(/read it again/);
        f.agent.supersedeAnswer(f.source.workId, f.sourceRevision, f.input);
        expect(f.records.decisionAnswer(f.source.workId).replacement?.text).toBe(
            kind === 'decision' ? 'New answer' : 'New contract',
        );
        expect(f.records.gate(f.affected.workId).passing).toBeNull();
        expect(f.records.answerHistory(f.source.workId)[0]?.text).toBe('Old answer');
        for (const record of [f.source, f.replacement, f.affected])
            expect(f.records.read(record.workId).needsYou).toBe('Concurrent note');
    },
);

it.each(['answer', 'replacement', 'affected gate'])(
    'refuses supersession after a conflicting %s change',
    async (change) => {
        const f = await answerFixture();

        if (change === 'answer') f.body(f.source.workId, 'answer', 'Revised answer');

        if (change === 'replacement') f.body(f.replacement.workId, 'answer', 'Revised replacement');

        if (change === 'affected gate') f.records.invalidateGate(f.affected.workId, f.revision(f.affected.workId));

        const before = f.records.list({});

        expect(() => f.agent.supersedeAnswer(f.source.workId, f.sourceRevision, f.input)).toThrow(
            /conflicting fields:/,
        );
        expect(f.records.list({})).toEqual(before);
        expect(f.records.decisionAnswer(f.source.workId).current).not.toBeNull();
    },
);

it('retains exact answer revision errors and retries a race on an affected record from the original intent', async () => {
    const f = await answerFixture();

    expect(() => f.agent.supersedeAnswer(f.source.workId, f.sourceRevision, { ...f.input, answerRevision: 9 })).toThrow(
        'Read the current decision answer before superseding its exact revision.',
    );

    const strict = f.records.supersedeAnswer.bind(f.records);

    vi.spyOn(f.records, 'supersedeAnswer').mockImplementationOnce((id, revision, input) => {
        f.note(f.affected.workId);

        return strict(id, revision, input);
    });
    f.agent.supersedeAnswer(f.source.workId, f.sourceRevision, f.input);
    expect(f.records.read(f.affected.workId).needsYou).toBe('Concurrent note');
    expect(f.records.decisionAnswer(f.source.workId).current).toBeNull();
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

it.each(['answer', 'domain-drafts'] as const)('refuses a stale map after a child’s %s changes', async (body) => {
    const f = await answerFixture();

    f.body(f.source.workId, 'domain-drafts', 'none');
    f.body(f.parent.workId, 'map', 'Reviewed map');

    const revision = f.revision(f.parent.workId);

    f.note(f.parent.workId);
    f.agent.setBody(f.parent.workId, revision, 'map', 'Reviewed map with a note');

    const beforeAnswer = f.revision(f.parent.workId);
    const beforeFinish = f.revision(f.source.workId);

    f.body(f.source.workId, body, 'Unreviewed child change');
    expect(() => f.agent.setBody(f.parent.workId, beforeAnswer, 'map', 'Stale incorporation')).toThrow(
        /decisionAnswers/,
    );
    expect(f.records.body(f.parent.workId, 'map')).toBe('Reviewed map with a note');
    expect(() => f.agent.recordFinished(f.source.workId, beforeFinish)).toThrow(/answerState|body.domain-drafts/);
});
