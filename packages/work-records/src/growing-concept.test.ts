import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { scopeMarkdown, type BriefScope } from './brief-scope.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 's06-growth-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    const g = records.create({ title: 'Greeting exchange', repository: 'fake/a', kind: 'concept' });
    const part = (title: string, body: string, kind: 'build' | 'decision' = 'build') =>
        records.createPart({
            title,
            body,
            kind,
            repository: 'fake/a',
            parentId: g.workId,
            parentRevision: records.read(g.workId).revision,
            blockerIds: [],
        });
    const approve = (id: string) => {
        const input = records.doubtPackage(id);

        records.recordDoubt(
            id,
            input.packageDigest,
            'Doubt',
            'Checked current dependencies.',
            input.overlaps
                .filter((o) => !o.ordered)
                .map((o) => ({ otherWorkId: o.otherWorkId, reason: 'Independent additive proofs.' })),
        );

        const manifest = records.gateBatch([id]);

        records.recordGateBatch(manifest, manifest.digest, 'Pedro', 'Board action fixture.');
    };

    return { records, dir, g, part, approve };
}

test('S06: adding D1 and editing another build Notes preserve b01 approval and nineteen-member batch', async () => {
    const { records, g, part, approve } = await fixture();
    const b01 = part('b01 static title', 'Static title only.\nFiles: `title.mjs`');

    approve(b01.workId);
    part('D1 exchange contract', 'Method: grill\nWhich exchange?', 'decision');
    expect(records.gate(b01.workId).current).toBe(true);

    const builds = Array.from({ length: 19 }, (_, n) => part(`b${n + 2}`, `Assertion ${n}.\nFiles: \`case-${n}.mjs\``));

    for (const b of builds) {
        const input = records.doubtPackage(b.workId);

        records.recordDoubt(b.workId, input.packageDigest, 'Doubt', 'Independent assertion checked.', []);
    }

    const batch = records.gateBatch(builds.map((b) => b.workId));

    expect(batch.members).toHaveLength(19);
    expect(batch.members.some((m) => m.display.workId === b01.workId)).toBe(false);
    records.recordGateBatch(batch, batch.digest, 'Pedro', 'One nineteen-member board action.');

    const last = builds.at(-1)!;

    records.setBody(
        last.workId,
        records.read(last.workId).revision,
        'brief',
        `${records.body(last.workId, 'brief')}\n## Notes\nUse the sandbox fixture only.`,
    );
    expect([b01, ...builds.slice(0, -1)].every((b) => records.gate(b.workId).current)).toBe(true);
    expect(records.gate(last.workId).current).toBe(false);
    expect(
        records
            .children(g.workId)
            .filter((b) => b.kind === 'build' && !records.gate(b.workId).current)
            .map((b) => b.workId),
    ).toEqual([last.workId]);
});

test('S06: only cited answers and named sibling contracts invalidate approval', async () => {
    const { records, part, approve } = await fixture();
    const d = part('D2 transport', 'Method: grill\nTransport?', 'decision');

    records.setBody(d.workId, d.revision, 'answer', 'Use a fragment.');

    const b = part('b02 producer', 'Contracts: `greeting-v1`\n## Done when\nProduce v1.\n## Notes\nUse sample.');
    const consumer = part('b09 proof', `Answers: \`${d.workId}\`\nContracts: \`greeting-v1\`\nProve v1.`);

    approve(consumer.workId);
    records.setBody(
        b.workId,
        records.read(b.workId).revision,
        'brief',
        records.body(b.workId, 'brief')!.replace('Use sample.', 'Use sandbox.'),
    );
    expect(records.gate(consumer.workId).current).toBe(true);
    records.setBody(d.workId, records.read(d.workId).revision, 'answer', 'Use a query.');
    expect(records.gate(consumer.workId).current).toBe(false);
    approve(consumer.workId);
    records.setBody(
        b.workId,
        records.read(b.workId).revision,
        'brief',
        'Contracts: `greeting-v1`\n## Done when\nProduce v2.',
    );
    expect(records.gate(consumer.workId).current).toBe(false);
});

test('S06: reconcile reports missing b02 to b09 edge and sync derives the complete graph from declarations', async () => {
    const { records, g, part } = await fixture();
    const b02 = part('b02 producer', 'Producer.\nBlocked by: none');
    const x = records.create({ title: 'x envelope', repository: 'fake/a', kind: 'build' });
    const b09 = part('b09 proof', `Proof.\nBlocked by: \`${b02.workId}\`, \`${x.workId}\``);

    records.addBlocker(b09.workId, records.read(b09.workId).revision, x.workId);
    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({ key: `declared-blockers:${b09.workId}`, requiresFix: true }),
    );

    const revisions = Object.fromEntries([g, b02, b09, x].map((b) => [b.workId, records.read(b.workId).revision]));

    records.syncBlockers(g.workId, revisions);
    expect(
        records
            .blockers(b09.workId)
            .map((b) => b.workId)
            .sort(),
    ).toEqual([b02.workId, x.workId].sort());
    expect(records.reconcile(g.workId).items.some((i) => i.key.startsWith('declared-blockers:'))).toBe(false);
});

test('S06: fourteen-part growth commits records, ticket requests, graph and map together or nothing', async () => {
    const { records, dir, g } = await fixture();
    const parts = Array.from({ length: 14 }, (_, n) => ({
        key: `b${n + 9}`,
        title: `Proof ${n}`,
        repository: 'fake/a',
        kind: 'build' as const,
        body: `Proof ${n}.`,
        blockerIds: n ? [`$b${n + 8}`] : [],
        ticketRequestId: randomUUID(),
    }));
    const input = { map: '## Destination\nGreeting exchange.\n## Fog\nnone', parts };
    const before = records.list({});

    expect(() =>
        records.createParts(g.workId, g.revision, {
            ...input,
            parts: [...parts.slice(0, -1), { ...parts.at(-1)!, blockerIds: ['$missing'] }],
        }),
    ).toThrow(/Unknown part reference/);
    expect(records.list({})).toEqual(before);
    expect(records.body(g.workId, 'map')).toBeNull();
    expect(records.partTicketRequests(g.workId)).toEqual([]);

    const observer = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records: observer, dir });

    const createPart = records.createPart.bind(records);
    const spy = vi.spyOn(records, 'createPart').mockImplementation((part) => {
        const result = createPart(part);

        expect(observer.children(g.workId)).toEqual([]);
        expect(observer.partTicketRequests(g.workId)).toEqual([]);
        expect(observer.body(g.workId, 'map')).toBeNull();

        return result;
    });
    const result = records.createParts(g.workId, g.revision, input);

    spy.mockRestore();
    expect(observer.children(g.workId)).toHaveLength(14);

    expect(result.parts).toHaveLength(14);
    expect(records.children(g.workId)).toHaveLength(14);
    expect(records.partTicketRequests(g.workId)).toHaveLength(14);
    expect(records.body(g.workId, 'map')).toBe(input.map);
    expect(records.blockers(result.parts[13]!.workId).map((b) => b.workId)).toEqual([result.parts[12]!.workId]);
    expect(() => records.createParts(g.workId, g.revision, input)).toThrow(/revision/);
    expect(records.children(g.workId)).toHaveLength(14);
});

test('S06: incorporation settles decisions immediately; changed approved draft returns to Shaping', async () => {
    const { records, g, part, approve } = await fixture();
    const d = part('D2', 'Method: grill\nTransport?', 'decision');

    records.update(d.workId, d.revision, { status: 'Shaping' });
    records.setBody(d.workId, records.read(d.workId).revision, 'answer', 'Fragment.');
    records.setBody(d.workId, records.read(d.workId).revision, 'domain-drafts', 'none');
    records.setBody(g.workId, records.read(g.workId).revision, 'map', '## Destination\nFragment exchange.');
    expect(records.read(d.workId)).toMatchObject({ status: 'Done', finishedAt: expect.any(String) });

    const b = part('b08', 'Compatibility proof.');

    approve(b.workId);
    records.update(b.workId, records.read(b.workId).revision, { status: 'Ready' });
    records.setBody(b.workId, records.read(b.workId).revision, 'brief', 'Direct equivalence proof.');
    expect(records.read(b.workId).status).toBe('Shaping');
    expect(() => records.update(b.workId, records.read(b.workId).revision, { status: 'Queued' })).toThrow(
        /Shaping|gate/,
    );
});

test('S06: structure classifies standalone implementation as Build', async () => {
    const { records } = await fixture();
    const x = records.create({ title: 'x envelope', repository: 'fake/a', kind: 'improvement' });
    const scope: BriefScope = {
        repositories: ['fake/a'],
        openDecisions: [],
        files: ['fixture.json'],
        tests: [],
        behaviour: ['Envelope extensible.'],
        excluded: [],
        size: 'Small',
        verify: { required: false, visibleUi: null },
    };

    records.confirmScope(x.workId, x.revision, scope, 'Pedro', 'Yes.');
    records.setBody(x.workId, records.read(x.workId).revision, 'brief', scopeMarkdown(scope));
    records.chooseStructure(x.workId);
    expect(records.read(x.workId).kind).toBe('build');
});

test('S06: later incorporation holds stale current answers and map stage prose, preserving answer history', async () => {
    const { records, g, part } = await fixture();
    const d2 = part('D2 transport', 'Method: grill\nTransport?', 'decision');

    records.setBody(d2.workId, d2.revision, 'answer', 'D3 and D4 remain unanswered.');
    records.setBody(d2.workId, records.read(d2.workId).revision, 'domain-drafts', 'none');
    records.setBody(g.workId, records.read(g.workId).revision, 'map', 'Prepare nineteen builds except b01.');

    const d3 = part('D3 view', 'Method: grill\nView?', 'decision');

    records.setBody(d3.workId, d3.revision, 'answer', 'One view. D4 remains unanswered.');
    records.setBody(d3.workId, records.read(d3.workId).revision, 'domain-drafts', 'none');

    const d4 = part('D4 coverage', 'Method: grill\nCoverage?', 'decision');

    records.setBody(d4.workId, d4.revision, 'answer', 'Use the sample fixture only.');
    records.setBody(d4.workId, records.read(d4.workId).revision, 'domain-drafts', 'none');

    const b22 = part('b22 empty proof', '## Notes\nUse the sandbox fixture only.');
    const report = records.reconcile(g.workId);

    for (const id of [d2.workId, d3.workId, d4.workId])
        expect(report.items).toContainEqual(
            expect.objectContaining({ key: `projection:answer:${id}`, requiresFix: true }),
        );
    expect(report.items).toContainEqual(
        expect.objectContaining({ key: `projection:map:${g.workId}`, requiresFix: true }),
    );
    records.refreshProjections(
        g.workId,
        Object.fromEntries([g, d2, d3, d4, b22].map((r) => [r.workId, records.read(r.workId).revision])),
        {
            map: 'Greeting exchange uses a fragment and one view. Coverage settled; gates pending.',
            answers: {
                [d2.workId]: 'Fragment transport; later decisions settled.',
                [d3.workId]: 'One view; coverage settled.',
                [d4.workId]: 'Coverage settled. Use the sandbox fixture only.',
            },
        },
    );
    expect(
        records
            .reconcile(g.workId)
            .items.some((i) => i.key.startsWith('projection:answer:') || i.key.startsWith('projection:map:')),
    ).toBe(false);
    expect(records.answerHistory(d2.workId)[0]?.text).toBe('D3 and D4 remain unanswered.');
    expect(records.mapHistory(g.workId).map((v) => v.text)).toContain('Prepare nineteen builds except b01.');
});

test('S06: D1 seven declared blockers replace its six erroneous stored edges in one sync', async () => {
    const { records, g, part } = await fixture();
    const builds = Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((n) => [n, part(`b0${n}`, `Build ${n}.`)]));

    for (const [from, to] of [
        [3, 4],
        [6, 4],
        [4, 5],
        [2, 6],
        [5, 7],
        [6, 8],
    ])
        records.addBlocker(builds[to!]!.workId, records.read(builds[to!]!.workId).revision, builds[from!]!.workId);

    const declared: Record<number, number[]> = { 2: [], 3: [2], 4: [6], 5: [3, 4], 6: [2], 7: [4], 8: [6] };

    for (const [n, build] of Object.entries(builds))
        records.setBody(
            build.workId,
            records.read(build.workId).revision,
            'brief',
            `Build ${n}.\nBlocked by: ${declared[Number(n)]!.length ? declared[Number(n)]!.map((b) => `\`${builds[b]!.workId}\``).join(', ') : 'none'}`,
        );

    const revisions = () => Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision]));
    const before = records.children(g.workId).map((r) => records.blockers(r.workId).map((b) => b.workId));

    expect(() => records.syncBlockers(g.workId, { ...revisions(), [builds[5]!.workId]: 1 })).toThrow(/revision/);
    expect(records.children(g.workId).map((r) => records.blockers(r.workId).map((b) => b.workId))).toEqual(before);
    records.syncBlockers(g.workId, revisions());
    expect(records.children(g.workId).flatMap((r) => records.blockers(r.workId))).toHaveLength(7);
    for (const [n, build] of Object.entries(builds))
        expect(
            records
                .blockers(build.workId)
                .map((b) => b.workId)
                .sort(),
        ).toEqual(declared[Number(n)]!.map((b) => builds[b]!.workId).sort());
});

test('S06: linked growth also saves all parts and its map without reclassifying the parent', async () => {
    const { records } = await fixture();
    const parent = records.create({ title: 'Linked greeting', repository: 'fake/a', kind: 'build' });
    const result = records.createParts(parent.workId, parent.revision, {
        map: 'Greeting producer then view.',
        parts: [
            {
                key: 'producer',
                title: 'Producer',
                repository: 'fake/a',
                kind: 'build',
                body: 'Produce v1.',
                blockerIds: [],
            },
            {
                key: 'view',
                title: 'View',
                repository: 'fake/c',
                kind: 'build',
                body: 'Show v1.',
                blockerIds: ['$producer'],
            },
        ],
    });

    expect(records.read(parent.workId).kind).toBe('build');
    expect(records.body(parent.workId, 'map')).toBe('Greeting producer then view.');
    expect(records.blockers(result.keys.view!).map((r) => r.workId)).toEqual([result.keys.producer]);
});

test('S06: upgrading a still-current legacy review preserves its approval through unrelated growth', async () => {
    const { records, dir, g, part, approve } = await fixture();
    const b01 = part('b01 static title', 'Static title.');

    approve(b01.workId);

    const { packageDigest: _digest, ...content } = records.doubtPackage(b01.workId);
    const legacy = createHash('sha256')
        .update(JSON.stringify({ ...content, overlaps: undefined }))
        .digest('hex');
    const db = new DatabaseSync(join(dir, 'records.db'));
    const row = db
        .prepare('SELECT content FROM doubt_reviews WHERE work_id=? ORDER BY rowid DESC LIMIT 1')
        .get(b01.workId)!;
    const review = JSON.parse(String(row.content));

    delete review.dependencyVersion;
    review.packageDigest = legacy;
    db.prepare('UPDATE doubt_reviews SET content=? WHERE review_id=?').run(JSON.stringify(review), review.reviewId);
    db.prepare('UPDATE brief_gates SET review_digest=? WHERE work_id=?').run(legacy, b01.workId);
    db.close();

    const upgraded = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records: upgraded, dir });
    expect(upgraded.gate(b01.workId).current).toBe(true);
    upgraded.createPart({
        title: 'D1',
        repository: 'fake/a',
        kind: 'decision',
        body: 'Method: grill\nExchange?',
        parentId: g.workId,
        parentRevision: upgraded.read(g.workId).revision,
        blockerIds: [],
    });
    expect(upgraded.gate(b01.workId).current).toBe(true);
    expect(upgraded.gate(b01.workId).evidence).toHaveLength(1);
});

test('S06: legacy free-prose ordering cannot reconcile clean until its owner declares an exact graph', async () => {
    const { records, g, part } = await fixture();
    const producer = part('b02 producer', 'Produce a v1 greeting.');
    const proof = part('b09 proof', 'Prove the producer equivalence after the producer is delivered.');

    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({ key: `blocker-declaration:${proof.workId}`, requiresFix: true }),
    );

    const revisions = () => Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision]));

    expect(() => records.syncBlockers(g.workId, revisions())).toThrow(/Normalize brief\/map/);
    records.setBody(
        g.workId,
        records.read(g.workId).revision,
        'map',
        `## Destination\nGreeting exchange.\nBlocker: \`${producer.workId}\` <- none\nBlocker: \`${proof.workId}\` <- \`${producer.workId}\``,
    );
    records.syncBlockers(g.workId, revisions());
    expect(records.blockers(proof.workId).map((r) => r.workId)).toEqual([producer.workId]);
    expect(records.reconcile(g.workId).items.some((i) => i.key.startsWith('blocker-declaration:'))).toBe(false);
});
