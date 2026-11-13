import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords;
let dir: string;

afterEach(() => {
    records?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    dir = mkdtempSync(join(tmpdir(), 'decision-answers-'));
    records = await openWorkRecords(join(dir, 'work.db'));

    const concept = records.create({ title: 'Destination', repository: 'example/repo', kind: 'concept' });
    const decision = records.create({ title: 'Contract', repository: 'example/repo', kind: 'decision' });
    const gateBuild = records.create({ title: 'Change contract', repository: 'example/repo', kind: 'build' });
    const sibling = records.create({ title: 'Use contract', repository: 'example/repo', kind: 'build' });

    for (const item of [decision, gateBuild, sibling]) records.setParent(item.workId, 1, concept.workId);

    const revision = (id: string) => records.read(id).revision;
    const body = (id: string, body: 'answer' | 'domain-drafts' | 'brief' | 'map', text: string) =>
        records.setBody(id, revision(id), body, text);

    body(decision.workId, 'answer', 'Call /old-endpoint');
    body(decision.workId, 'domain-drafts', 'none');
    body(concept.workId, 'map', 'Contract incorporated');

    const gate = (id: string, text: string) => {
        body(id, 'brief', text);
        records.recordGate(id, revision(id), {
            briefDigest: records.gate(id).briefDigest!,
            approvedBy: 'user',
            evidence: 'Approved',
        });

        return records.gate(id).passing!.gateId;
    };
    const gateId = gate(gateBuild.workId, 'Use the replacement contract. No public endpoint.');

    gate(sibling.workId, 'Follow the old endpoint');
    records.update(sibling.workId, revision(sibling.workId), { status: 'Ready' });

    return { concept, decision, gateBuild, sibling, revision, body, gate, gateId };
}

test('answer edits create durable versions and reopen exact-version incorporation', async () => {
    const f = await fixture();

    expect(records.completion(f.decision.workId).complete).toBe(true);

    const parentRevision = f.revision(f.concept.workId);

    f.body(f.decision.workId, 'answer', 'Use new contract');
    expect(() => records.setBody(f.concept.workId, parentRevision, 'map', 'Stale incorporation')).toThrow(
        'read it again',
    );
    expect(records.answerHistory(f.decision.workId).map((a) => [a.revision, a.current, a.text])).toEqual([
        [1, false, 'Call /old-endpoint'],
        [2, true, 'Use new contract'],
    ]);
    expect(records.completion(f.decision.workId).complete).toBe(false);
    f.body(f.concept.workId, 'map', 'Version two incorporated');
    expect(records.completion(f.decision.workId).complete).toBe(true);
    expect(records.decisionAnswer(f.decision.workId).current?.incorporation?.conceptId).toBe(f.concept.workId);
    expect(
        records.children(f.concept.workId).find((r) => r.workId === f.decision.workId)?.decisionAnswer,
    ).toMatchObject({ revision: 2, current: true });
    records.close();
    records = await openWorkRecords(join(dir, 'work.db'));
    expect(records.body(f.decision.workId, 'answer')).toBe('Use new contract');
    expect(records.answerHistory(f.decision.workId)[0]?.supersededBy).toMatchObject({
        workId: f.decision.workId,
        answerRevision: 2,
    });
});
test('gate supersession exposes the replacement contract and invalidates affected approval atomically', async () => {
    const f = await fixture();
    const by = {
        kind: 'gate' as const,
        workId: f.gateBuild.workId,
        revision: f.revision(f.gateBuild.workId),
        gateId: f.gateId,
    };
    const affected = [{ workId: f.sibling.workId, revision: f.revision(f.sibling.workId) }];

    records.supersedeAnswer(f.decision.workId, f.revision(f.decision.workId), { answerRevision: 1, by, affected });
    expect(records.decisionAnswer(f.decision.workId)).toMatchObject({
        current: null,
        supersededBy: { kind: 'gate', gateId: f.gateId },
        replacement: { text: 'Use the replacement contract. No public endpoint.' },
    });
    expect(records.body(f.decision.workId, 'answer')).toBeNull();
    expect(records.answerHistory(f.decision.workId)[0]?.text).toBe('Call /old-endpoint');
    expect(records.gate(f.sibling.workId).passing).toBeNull();
    expect(records.read(f.sibling.workId).status).toBe('Shaping');
    expect(records.completion(f.decision.workId).complete).toBe(false);
    f.body(f.concept.workId, 'map', 'Replacement incorporated');
    expect(records.completion(f.decision.workId).complete).toBe(true);
    records.invalidateGate(f.gateBuild.workId, f.revision(f.gateBuild.workId));
    expect(records.decisionAnswer(f.decision.workId).replacement).toBeNull();
    expect(records.completion(f.decision.workId).complete).toBe(false);
});
test('later decision revisions resolve through history and reopen the old incorporation', async () => {
    const f = await fixture();
    const later = records.create({ title: 'Later decision', repository: 'example/repo', kind: 'decision' });

    records.setParent(later.workId, 1, f.concept.workId);
    f.body(later.workId, 'answer', 'New answer');
    f.body(later.workId, 'domain-drafts', 'none');
    records.supersedeAnswer(f.decision.workId, f.revision(f.decision.workId), {
        answerRevision: 1,
        by: { kind: 'decision', workId: later.workId, revision: f.revision(later.workId), answerRevision: 1 },
        affected: [],
    });
    f.body(f.concept.workId, 'map', 'Later answer incorporated');
    expect(records.completion(f.decision.workId).complete).toBe(true);
    f.body(later.workId, 'answer', 'Latest answer');
    expect(records.decisionAnswer(f.decision.workId).replacement?.text).toBe('Latest answer');
    expect(records.completion(f.decision.workId).complete).toBe(false);
});
test('stale affected record aborts supersession and leaves every approval and answer untouched', async () => {
    const f = await fixture();
    const before = records.list({});

    expect(() =>
        records.supersedeAnswer(f.decision.workId, f.revision(f.decision.workId), {
            answerRevision: 1,
            by: {
                kind: 'gate',
                workId: f.gateBuild.workId,
                revision: f.revision(f.gateBuild.workId),
                gateId: f.gateId,
            },
            affected: [{ workId: f.sibling.workId, revision: 1 }],
        }),
    ).toThrow('read it again');
    expect(records.list({})).toEqual(before);
    expect(records.decisionAnswer(f.decision.workId).current?.text).toBe('Call /old-endpoint');
    expect(records.gate(f.sibling.workId).passing).not.toBeNull();
});

test('refuses a historical gate even when the build has a newer passing brief', async () => {
    const f = await fixture();

    f.gate(f.gateBuild.workId, 'A later approved contract');

    const before = records.list({});

    expect(() =>
        records.supersedeAnswer(f.decision.workId, f.revision(f.decision.workId), {
            answerRevision: 1,
            by: {
                kind: 'gate',
                workId: f.gateBuild.workId,
                revision: f.revision(f.gateBuild.workId),
                gateId: f.gateId,
            },
            affected: [],
        }),
    ).toThrow('current passing gate');
    expect(records.list({})).toEqual(before);
});
