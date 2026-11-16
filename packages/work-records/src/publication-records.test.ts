import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openWorkRecords, WorkRecordError, type WorkRecords } from './work-records.ts';

const opened: WorkRecords[] = [];
const dirs: string[] = [];
const open = async (path = join(tempDir(), 'work-records.db')) => {
    const records = await openWorkRecords(path);

    opened.push(records);

    return records;
};

function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), 'publication-'));

    dirs.push(dir);

    return dir;
}

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('ties gate evidence to the exact brief across execution metadata changes', async () => {
    const records = await open();
    let work = records.create({ title: 'Search', repository: 'team/app', kind: 'build', status: 'Ready' });

    expect(records.gate(work.workId)).toMatchObject({ current: false, briefDigest: null, evidence: [] });
    work = records.setBody(work.workId, work.revision, 'brief', 'Find a saved search.');

    const digest = records.gate(work.workId).briefDigest!;
    const evidence = records.recordGate(work.workId, work.revision, {
        briefDigest: digest,
        approvedBy: 'reviewer',
        evidence: 'Doubt review passed; assumptions confirmed.',
    });

    expect(evidence).toMatchObject({ briefDigest: digest, approvedBy: 'reviewer', sourceRevision: 2 });
    work = records.setBuildPhase(work.workId, work.revision, 'implement');
    expect(records.gate(work.workId).current).toBe(true);
    expect(() =>
        records.recordGate(work.workId, 1, { briefDigest: digest, approvedBy: 'reviewer', evidence: 'passed' }),
    ).toThrow(/revision/);
    work = records.setBody(work.workId, work.revision, 'brief', 'Find every search.');
    expect(records.gate(work.workId)).toMatchObject({ current: false, evidence: [evidence] });
    expect(() =>
        records.recordGate(work.workId, work.revision, {
            briefDigest: digest,
            approvedBy: 'reviewer',
            evidence: 'passed',
        }),
    ).toThrow(/brief changed/);
});

async function passingBuild(records: WorkRecords) {
    const made = records.create({ title: 'Search', repository: 'team/app', kind: 'build' });
    const work = records.setBody(made.workId, made.revision, 'brief', 'Find a saved search.');

    records.recordGate(work.workId, work.revision, {
        briefDigest: records.gate(work.workId).briefDigest!,
        approvedBy: 'reviewer',
        evidence: 'Passed.',
    });

    return work;
}

function proposal(records: WorkRecords, workId: string): import('@lar-factory/shared').PublicationProposal {
    return {
        sources: records.publicationReadiness(workId).sources.map(({ workId, revision }) => ({ workId, revision })),
        tickets: [
            {
                workId,
                destination: { provider: 'github', repository: 'team/app' },
                vocabulary: { build: { type: 'Task', labels: ['Search'] } },
                typeResolution: { candidates: ['Task'], selected: 'Task' },
                title: 'Find saved searches',
                body: 'Find saved searches by name.',
            },
        ],
        operations: [
            { kind: 'create', operationId: 'create-build', ticketWorkId: workId, dependsOn: [] },
            {
                kind: 'comment',
                operationId: 'update-note',
                ticketWorkId: workId,
                dependsOn: ['create-build'],
                content: 'Search by name.',
            },
        ],
    };
}

function approve(records: WorkRecords, workId: string, input = proposal(records, workId)) {
    const plan = records.proposePublication(workId, records.read(workId).revision, input);

    return records.approvePublication(workId, plan.planId, plan.revision, plan.digest, 'pedro');
}

it('persists approval, successful text, uncertainty and the next operation across reopening', async () => {
    const path = join(tempDir(), 'work-records.db');
    const records = await open(path);
    const work = await passingBuild(records);
    const input = proposal(records, work.workId);
    const content = { tickets: input.tickets, operations: input.operations };
    const plan = approve(records, work.workId, input);
    const first = records.claimPublication(work.workId, plan.planId, plan.revision, plan.digest, content, 'board');
    const result = records.recordPublicationOutcome(
        work.workId,
        plan.planId,
        first.plan.revision,
        'create-build',
        first.claimToken,
        {
            status: 'successful',
            evidence: 'Controlled creation response #12.',
            ticket: 'team/app#12',
            url: 'https://example.test/issues/12',
            location: { kind: 'body', start: 0, end: 28 },
        },
    );

    expect(result.results.map((item) => item.status)).toEqual(['successful', 'pending']);

    const reopened = await open(path);

    expect(reopened.publication(work.workId, plan.planId)).toEqual(result);
    expect(reopened.pendingPublication(work.workId, plan.planId).next?.operationId).toBe('update-note');

    const linked = reopened.attachPublicationUrl(
        work.workId,
        work.revision,
        plan.planId,
        'team/app#12',
        'https://example.test/issues/12',
    );

    expect(linked).toMatchObject({ workId: work.workId, status: 'List', ticket: 'team/app#12' });
    expect(reopened.body(work.workId, 'brief')).toBe('Find a saved search.');
    expect(reopened.pendingPublication(work.workId, plan.planId).current).toBe(true);

    const second = reopened.claimPublication(work.workId, plan.planId, result.revision, plan.digest, content, 'cli');
    const afterCrash = await open(path);

    expect(afterCrash.pendingPublication(work.workId, plan.planId)).toMatchObject({
        next: null,
        uncertain: ['update-note'],
        successful: ['create-build'],
    });
    expect(() =>
        afterCrash.claimPublication(work.workId, plan.planId, second.plan.revision, plan.digest, content, 'board'),
    ).toThrow(/No operation/);

    const resolved = afterCrash.resolvePublicationOutcome(
        work.workId,
        plan.planId,
        second.plan.revision,
        'update-note',
        'pedro',
        {
            status: 'successful',
            evidence: 'Found the comment during reconciliation.',
            location: { kind: 'comment', commentId: 'comment-7' },
        },
    );

    expect(resolved.results.map((item) => item.status)).toEqual(['successful', 'successful']);
    expect(afterCrash.lastPublished(work.workId)).toMatchObject([
        { text: 'Find saved searches by name.', ticket: 'team/app#12', location: { kind: 'body', start: 0, end: 28 } },
        { text: 'Search by name.', location: { kind: 'comment', commentId: 'comment-7' } },
    ]);
    expect(afterCrash.publicationEvidence(work.workId, plan.planId)).toMatchObject([
        { operationId: 'create-build', evidence: expect.stringContaining('Claimed') },
        { operationId: 'create-build', evidence: expect.stringContaining('successful') },
        { operationId: 'update-note', evidence: expect.stringContaining('Claimed') },
        { operationId: 'update-note', evidence: expect.stringContaining('Resolved by pedro') },
    ]);
});

it('requires settled concepts and current gates for active builds without waiting for PR merges', async () => {
    const records = await open();
    let concept = records.create({ title: 'Search', repository: 'team/app', kind: 'concept' });
    let decision = records.create({ title: 'Match', repository: 'team/app', kind: 'decision' });
    let build = await passingBuild(records);

    decision = records.setParent(decision.workId, decision.revision, concept.workId);
    build = records.setParent(build.workId, build.revision, concept.workId);
    expect(records.publicationReadiness(concept.workId)).toMatchObject({
        eligible: false,
        reasons: expect.arrayContaining(['The concept still has Fog.']),
    });
    decision = records.setBody(decision.workId, decision.revision, 'answer', 'Match case insensitively.');
    records.setBody(decision.workId, decision.revision, 'domain-drafts', '');
    concept = records.read(concept.workId);
    concept = records.setBody(concept.workId, concept.revision, 'map', 'Search by name, ignoring case.');
    concept = records.setFogGone(concept.workId, concept.revision, true);
    expect(records.completion(concept.workId).complete).toBe(false);
    expect(records.publicationReadiness(concept.workId)).toMatchObject({
        eligible: true,
        reasons: [],
        sources: [
            { workId: concept.workId },
            { workId: decision.workId },
            { workId: build.workId, gate: { approvedBy: 'reviewer' } },
        ],
    });
    build = records.setBody(build.workId, build.revision, 'brief', 'Search by prefix.');
    expect(records.publicationReadiness(concept.workId)).toMatchObject({
        eligible: false,
        reasons: [expect.stringContaining('current passing gate')],
    });
    records.setAside(build.workId, build.revision);
    expect(records.publicationReadiness(concept.workId).eligible).toBe(true);
    expect(records.publicationReadiness(decision.workId).eligible).toBe(false);
});

it('requires fresh approval for content changes and preserves success through fallback plans', async () => {
    const records = await open();
    let work = await passingBuild(records);
    const input = proposal(records, work.workId);
    const content = { tickets: input.tickets, operations: input.operations };
    let plan = approve(records, work.workId, input);

    for (const change of [
        (next: typeof content) => {
            next.tickets[0]!.destination.project = 'Another project';
        },
        (next: typeof content) => {
            next.tickets[0]!.vocabulary.build!.labels = ['Another label'];
        },
        (next: typeof content) => {
            next.operations.pop();
        },
    ]) {
        const current = structuredClone(content);

        change(current);
        expect(records.pendingPublication(work.workId, plan.planId, current).current).toBe(false);
        expect(() =>
            records.claimPublication(work.workId, plan.planId, plan.revision, plan.digest, current, 'board'),
        ).toThrow(/changed/);
    }

    const first = records.claimPublication(work.workId, plan.planId, plan.revision, plan.digest, content, 'board');

    plan = records.recordPublicationOutcome(
        work.workId,
        plan.planId,
        first.plan.revision,
        'create-build',
        first.claimToken,
        {
            status: 'successful',
            evidence: 'Created.',
            ticket: 'team/app#12',
            url: 'https://example.test/issues/12',
            location: { kind: 'body', start: 0, end: 28 },
        },
    );

    const second = records.claimPublication(work.workId, plan.planId, plan.revision, plan.digest, content, 'cli');

    plan = records.recordPublicationOutcome(
        work.workId,
        plan.planId,
        second.plan.revision,
        'update-note',
        second.claimToken,
        { status: 'failed', evidence: 'Comment refused.' },
    );
    expect(records.pendingPublication(work.workId, plan.planId)).toMatchObject({
        next: null,
        failed: ['update-note'],
        successful: ['create-build'],
    });

    const replacement = records.proposePublication(work.workId, work.revision, { ...input, replaces: plan.planId });

    expect(replacement).toMatchObject({
        approval: null,
        replaces: plan.planId,
        results: [{ status: 'successful' }, { status: 'pending' }],
    });
    expect(records.publication(work.workId, plan.planId)).toMatchObject({
        supersededBy: replacement.planId,
        results: [{ status: 'successful' }, { status: 'failed' }],
    });
    expect(() =>
        records.claimPublication(
            work.workId,
            replacement.planId,
            replacement.revision,
            replacement.digest,
            content,
            'cli',
        ),
    ).toThrow(/needs approval/);

    const approved = records.approvePublication(
        work.workId,
        replacement.planId,
        replacement.revision,
        replacement.digest,
        'pedro',
    );

    work = records.setBody(work.workId, work.revision, 'brief', 'Find a different search.');
    expect(records.pendingPublication(work.workId, approved.planId).current).toBe(false);
    expect(() =>
        records.claimPublication(work.workId, approved.planId, approved.revision, approved.digest, content, 'cli'),
    ).toThrow(/changed|gate/);
    expect(records.publication(work.workId, plan.planId).approval).toEqual(plan.approval);
});

it('allows one claim across connections and keeps a simulated provider write uncertain after a crash', async () => {
    const path = join(tempDir(), 'work-records.db');
    const records = await open(path);
    const work = await passingBuild(records);
    const plan = approve(records, work.workId);
    const workers = [await openWorkRecords(path), await openWorkRecords(path)];
    let results: string[];

    try {
        const read = workers.map((worker) => worker.publication(work.workId, plan.planId));

        results = workers.map((worker, index) => {
            const { workId, planId, digest, tickets, operations } = read[index]!;

            try {
                worker.claimPublication(workId, planId, 2, digest, { tickets, operations }, 'worker');

                return 'claimed';
            } catch (error) {
                if (!(error instanceof WorkRecordError) || error.code !== 'stale-revision') throw error;

                return 'lost';
            }
        });
    } finally {
        for (const worker of workers) worker.close();
    }

    expect(results.toSorted()).toEqual(['claimed', 'lost']);
    expect(records.pendingPublication(work.workId, plan.planId)).toMatchObject({
        uncertain: ['create-build'],
        next: null,
    });

    let saved = records.publication(work.workId, plan.planId);

    saved = records.resolvePublicationOutcome(work.workId, plan.planId, saved.revision, 'create-build', 'pedro', {
        status: 'failed',
        evidence: 'Neither worker dispatched to the provider.',
    });

    const next = records.proposePublication(work.workId, work.revision, {
        ...proposal(records, work.workId),
        replaces: saved.planId,
    });
    const approved = records.approvePublication(work.workId, next.planId, next.revision, next.digest, 'pedro');
    const crashing = await openWorkRecords(path);
    const claimed = crashing.publication(work.workId, approved.planId);

    crashing.claimPublication(
        claimed.workId,
        claimed.planId,
        claimed.revision,
        claimed.digest,
        { tickets: claimed.tickets, operations: claimed.operations },
        'crashing-worker',
    );

    // The provider created the ticket, then the worker died before recording it.
    const created = 'https://example.test/issues/12';

    crashing.close();

    const reopened = await open(path);

    expect(reopened.pendingPublication(work.workId, approved.planId)).toMatchObject({
        uncertain: ['create-build'],
        next: null,
    });

    const uncertain = reopened.publication(work.workId, approved.planId);

    expect(() =>
        reopened.proposePublication(work.workId, work.revision, {
            ...proposal(reopened, work.workId),
            replaces: approved.planId,
        }),
    ).toThrow(/Resolve uncertain/);

    const resolved = reopened.resolvePublicationOutcome(
        work.workId,
        approved.planId,
        uncertain.revision,
        'create-build',
        'pedro',
        {
            status: 'successful',
            evidence: 'Found the controlled provider ticket.',
            ticket: 'team/app#12',
            url: created,
            location: { kind: 'body', start: 0, end: 28 },
        },
    );

    expect(reopened.pendingPublication(work.workId, resolved.planId).next?.operationId).toBe('update-note');
});

it('retains recovery evidence and deletes terminal journals together with their records', async () => {
    const path = join(tempDir(), 'work-records.db');
    const records = await open(path);
    let work = await passingBuild(records);
    const input = proposal(records, work.workId);

    input.operations = input.operations.slice(0, 1);

    const plan = approve(records, work.workId, input);

    work = records.setAside(work.workId, work.revision);

    const retention = { hideAfterDays: 0, deleteAfterDays: 0 };

    expect(records.deleteExpired(retention)).toMatchObject({
        deleted: [],
        kept: [{ workId: work.workId, reason: expect.stringContaining('recovery evidence') }],
    });
    work = records.restore(work.workId, work.revision);

    const claim = records.claimPublication(
        work.workId,
        plan.planId,
        plan.revision,
        plan.digest,
        { tickets: input.tickets, operations: input.operations },
        'board',
    );

    records.setAside(work.workId, work.revision);
    expect(records.deleteExpired(retention).deleted).toEqual([]);
    records.recordPublicationOutcome(work.workId, plan.planId, claim.plan.revision, 'create-build', claim.claimToken, {
        status: 'successful',
        evidence: 'Created.',
        ticket: 'team/app#12',
        url: 'https://example.test/issues/12',
        location: { kind: 'body', start: 0, end: 28 },
    });
    expect(records.deleteExpired(retention)).toEqual({ deleted: [work.workId], kept: [] });
    expect(records.list({})).toEqual([]);

    const reopened = await open(path);

    expect(reopened.list({})).toEqual([]);
});

it('invalidates dispatch when a different ticket is attached outside the journal', async () => {
    const records = await open();
    const work = await passingBuild(records);
    const input = proposal(records, work.workId);
    const plan = approve(records, work.workId, input);

    records.attachTicket(work.workId, work.revision, 'team/app#15');
    expect(records.pendingPublication(work.workId, plan.planId).current).toBe(false);
    expect(() =>
        records.claimPublication(
            work.workId,
            plan.planId,
            plan.revision,
            plan.digest,
            { tickets: input.tickets, operations: input.operations },
            'board',
        ),
    ).toThrow(/destination|ticket/);
});

it('never recreates a completed ticket after multiple replacement plans', async () => {
    const records = await open();
    const work = await passingBuild(records);
    const input = proposal(records, work.workId);

    input.operations = input.operations.slice(0, 1);

    const first = approve(records, work.workId, input);
    const claim = records.claimPublication(
        work.workId,
        first.planId,
        first.revision,
        first.digest,
        { tickets: input.tickets, operations: input.operations },
        'board',
    );

    records.recordPublicationOutcome(work.workId, first.planId, claim.plan.revision, 'create-build', claim.claimToken, {
        status: 'successful',
        evidence: 'Created.',
        ticket: 'team/app#12',
        url: 'https://example.test/issues/12',
        location: { kind: 'body', start: 0, end: 28 },
    });

    const secondInput = structuredClone(input);

    secondInput.replaces = first.planId;
    secondInput.tickets[0]!.destination.ticket = 'team/app#12';
    secondInput.tickets[0]!.destination.url = 'https://example.test/issues/12';
    secondInput.operations = [];

    const second = approve(records, work.workId, secondInput);

    expect(() => records.proposePublication(work.workId, work.revision, { ...input, replaces: second.planId })).toThrow(
        /completed|known/,
    );
    expect(records.publications(work.workId)).toHaveLength(2);
});

it('claims a shared build creation only once across a concept plan and a standalone plan', async () => {
    const records = await open();
    let concept = records.create({ title: 'Search', repository: 'team/app', kind: 'concept' });
    let build = await passingBuild(records);

    build = records.setParent(build.workId, build.revision, concept.workId);
    concept = records.read(concept.workId);
    concept = records.setBody(concept.workId, concept.revision, 'map', 'Search by name.');
    concept = records.setFogGone(concept.workId, concept.revision, true);

    const standaloneInput = proposal(records, build.workId);

    standaloneInput.operations = standaloneInput.operations.slice(0, 1);

    const standalone = approve(records, build.workId, standaloneInput);
    const conceptInput = proposal(records, concept.workId);

    conceptInput.tickets[0]!.destination = {
        provider: 'github',
        repository: 'team/app',
        ticket: 'team/app#11',
        url: 'https://example.test/issues/11',
    };
    conceptInput.tickets.push(standaloneInput.tickets[0]!);
    conceptInput.operations = [
        { kind: 'create', operationId: 'shared-build', ticketWorkId: build.workId, dependsOn: [] },
    ];

    const parent = approve(records, concept.workId, conceptInput);
    const first = records.claimPublication(
        build.workId,
        standalone.planId,
        standalone.revision,
        standalone.digest,
        { tickets: standaloneInput.tickets, operations: standaloneInput.operations },
        'cli',
    );

    expect(() =>
        records.claimPublication(
            concept.workId,
            parent.planId,
            parent.revision,
            parent.digest,
            { tickets: conceptInput.tickets, operations: conceptInput.operations },
            'board',
        ),
    ).toThrow(/Another publication has an uncertain creation/);
    expect(records.publication(concept.workId, parent.planId)).toEqual(parent);
    records.recordPublicationOutcome(
        build.workId,
        standalone.planId,
        first.plan.revision,
        'create-build',
        first.claimToken,
        {
            status: 'successful',
            evidence: 'Created by the other publication.',
            ticket: 'team/app#12',
            url: 'https://example.test/issues/12',
            location: { kind: 'body', start: 0, end: 28 },
        },
    );
    expect(records.pendingPublication(concept.workId, parent.planId)).toMatchObject({ current: false, next: null });
});

it('backfills lightweight eligibility from existing briefs and exact gate evidence', async () => {
    const { createHash } = await import('node:crypto');
    const { openDatabase } = await import('./database.ts');
    const { MIGRATIONS } = await import('./migrations.ts');
    const path = join(tempDir(), 'records.db');
    // The schema before the backfill, the seventh step.
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 6) });
    const briefDigest = createHash('sha256').update(JSON.stringify('Known brief.')).digest('hex');

    for (const [id, brief] of [
        ['passed', 'Known brief.'],
        ['changed', 'Changed brief.'],
    ]) {
        old.db
            .prepare(
                'INSERT INTO work_records (work_id, repository, kind, status, revision, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
            )
            .run(id!, 'team/app', 'build', 'List', '', '');
        old.db
            .prepare('INSERT INTO bodies (work_id, body, markdown, written) VALUES (?, ?, ?, 1)')
            .run(id!, 'brief', brief!);
        old.db
            .prepare(
                'INSERT INTO brief_gates (gate_id, work_id, source_revision, brief_digest, approved_by, evidence, recorded_at) VALUES (?, ?, 1, ?, ?, ?, ?)',
            )
            .run(id!, id!, briefDigest, 'person', 'Passed.', '');
    }
    old.close();

    const records = await open(path);

    expect(records.publicationSummaries().get('passed')).toEqual({ eligible: true, reasons: [] });
    expect(records.publicationSummaries().get('changed')).toEqual({
        eligible: false,
        reasons: ['The brief for changed has no current passing gate.'],
    });
    expect(records.publicationReadiness('passed').eligible).toBe(true);
    expect(records.publicationReadiness('changed').eligible).toBe(false);
});
