import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { workOrder, workOrderReport } from './work-order.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 's06-coherence-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    const g = records.create({ title: 'Greeting exchange', repository: 'fake/a', kind: 'concept' });
    const part = (title: string, body: string, kind: 'build' | 'decision' = 'build') =>
        records.createPart({
            title,
            body: kind === 'build' ? completeBrief(body) : body,
            kind,
            repository: 'fake/a',
            parentId: g.workId,
            parentRevision: records.read(g.workId).revision,
            blockerIds: [],
        });
    const write = (id: string, body: 'brief' | 'map' | 'answer' | 'domain-drafts' | 'decision', text: string) =>
        records.setBody(id, records.read(id).revision, body, body === 'brief' ? completeBrief(text) : text);
    const revisions = () => Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision]));
    const approve = (id: string) => {
        const input = records.doubtPackage(id);

        records.recordDoubt(
            id,
            input.packageDigest,
            'Doubt',
            'Checked.',
            input.overlaps
                .filter((o) => !o.ordered)
                .map((o) => ({ otherWorkId: o.otherWorkId, reason: 'Independent.' })),
        );

        const batch = records.gateBatch([id]);

        records.recordGateBatch(batch, batch.digest, 'Pedro', 'Board fixture.');
    };

    return { records, dir, g, part, write, revisions, approve };
}

test('S06 A01: matching declarations cannot hide unresolved shared contract sources', async () => {
    const { records, g, part, write, revisions } = await fixture();
    const producer = part('b02 producer', 'Contracts: `greeting-message-v1`\nBlocked by: none');
    const x = part('x envelope', 'Blocked by: none');
    const consumer = part('b09 fixture', `Contracts: \`greeting-message-v1\`\nBlocked by: \`${x.workId}\``);

    records.addBlocker(consumer.workId, records.read(consumer.workId).revision, x.workId);
    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({
            workId: consumer.workId,
            kind: 'blocker',
            requiresFix: true,
            changes: expect.arrayContaining([producer.workId]),
        }),
    );
    expect(() => records.syncBlockers(g.workId, revisions())).toThrow(/contract.*source/i);
    write(
        producer.workId,
        'brief',
        'Contracts: `greeting-message-v1`\nProduces: `greeting-message-v1`\nBlocked by: none',
    );
    records.syncBlockers(g.workId, revisions());
    expect(
        records
            .blockers(consumer.workId)
            .map((r) => r.workId)
            .sort(),
    ).toEqual([x.workId, producer.workId].sort());
    expect(records.reconcile(g.workId).items.filter((i) => i.kind === 'blocker')).toEqual([]);
});

test('S06 D1: structured contract citations and Parts consumption add missing seventh edge', async () => {
    const { records, g, part, write, revisions } = await fixture();
    const builds = Array.from({ length: 8 }, (_, i) => part(`b0${i + 1}`, 'Blocked by: none'));

    for (let i = 1; i < builds.length - 1; i++) {
        const a = builds[i - 1]!,
            b = builds[i]!;

        write(b.workId, 'brief', `Blocked by: \`${a.workId}\``);
        records.addBlocker(b.workId, records.read(b.workId).revision, a.workId);
    }

    const last = builds.at(-1)!;

    write(last.workId, 'brief', 'Blocked by: none');
    write(g.workId, 'map', `## Parts\n- [build: ${last.workId}] Consumes: \`${builds[6]!.workId}\``);
    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({ key: `contract-blocker:${last.workId}:${builds[6]!.workId}`, requiresFix: true }),
    );
    records.syncBlockers(g.workId, revisions());
    expect(builds.flatMap((b) => records.blockers(b.workId))).toHaveLength(7);
    write(g.workId, 'map', records.body(g.workId, 'map')!);
    records.syncBlockers(g.workId, revisions());
    expect(builds.flatMap((b) => records.blockers(b.workId))).toHaveLength(7);
    write(
        last.workId,
        'brief',
        `## Done when\nUse output from \`${builds[6]!.workId}\`.\nBlocked by: none\nNo ordering needed: \`${builds[6]!.workId}\`: local constant, independently checked.`,
    );
    records.syncBlockers(g.workId, revisions());
    expect(records.blockers(last.workId)).toEqual([]);
});

test('S06 A04: stale exact answer quotes are holds even after a freshness attestation', async () => {
    const { records, g, part, write, revisions } = await fixture();
    const b22 = part('b22 empty proof', '## Notes for the builder\nUse the sample fixture only.\nBlocked by: none');
    const d4 = part('D4 coverage', 'Method: grill\nCoverage?', 'decision');
    const answer = `- b22 (${b22.workId}): Its Notes include the exact sentence "Use the sample fixture only."`;

    write(d4.workId, 'answer', answer);
    write(d4.workId, 'domain-drafts', 'none');
    write(g.workId, 'map', '## Destination\nGreeting exchange.');
    write(b22.workId, 'brief', '## Notes for the builder\nUse the sandbox fixture only.\nBlocked by: none');

    const before = records.answerHistory(d4.workId);

    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({ key: `answer-quote:${d4.workId}:${b22.workId}`, requiresFix: true }),
    );
    expect(() =>
        records.refreshProjections(g.workId, revisions(), {
            answers: { [d4.workId]: answer },
            map: '## Destination\nUpdated.',
        }),
    ).toThrow(/quote.*current brief/i);
    expect(records.answerHistory(d4.workId)).toEqual(before);
    expect(() => records.refreshProjections(g.workId, revisions(), { answers: {} })).toThrow(/quote.*current brief/i);
    records.refreshProjections(g.workId, revisions(), {
        answers: { [d4.workId]: answer.replace('sample', 'sandbox') },
    });
    expect(records.reconcile(g.workId).items.some((i) => i.key.startsWith('answer-quote:'))).toBe(false);
    expect(records.answerHistory(d4.workId)[0]!.text).toBe(answer);
});

test('S06 A05: map part state is generated from current records and preserves raw history', async () => {
    const { records, g, part, write, approve } = await fixture();
    const b03 = part('b03 fragment consumer', 'Decode a greeting.\nBlocked by: none');
    const stale = `## Destination\nGreeting exchange.\n## Parts\n- [build: ${b03.workId}] Spec remains out of date pending later board re-gating.\n## Fog\nnone`;

    write(g.workId, 'map', stale);
    records.attachTicket(b03.workId, records.read(b03.workId).revision, 'fake/a#3');
    approve(b03.workId);

    const state = records.specState(b03.workId);

    records.saveSpecState(b03.workId, state.generation, { ...state, active: true, pending: null });

    const projected = records.body(g.workId, 'map')!;

    expect(projected).not.toContain('pending later board re-gating');
    expect(projected).toContain('Ready');
    expect(projected).toContain('gate: current');
    expect(projected).toContain('Spec: current');
    expect(projected).toContain('phase: none');
    expect(records.mapHistory(g.workId).at(-1)!.text).toBe(stale);
    write(b03.workId, 'brief', 'Changed fragment.\nBlocked by: none');
    expect(records.body(g.workId, 'map')).toContain('gate: awaiting approval');
    expect(records.body(g.workId, 'map')).toContain('Spec: out of date');
});

test('S06: new file and contract overlaps hold ordering without invalidating x approval', async () => {
    const { records, g, part, write, approve, revisions } = await fixture();
    const x = records.create({ title: 'x envelope', repository: 'fake/a', kind: 'build' });

    write(x.workId, 'brief', 'Files: `fixtures/greeting.json`\nContracts: `format-1`\nBlocked by: none');
    approve(x.workId);

    const evidence = records.gate(x.workId).evidence;
    const b09 = part('b09 fixture', 'Files: `fixtures/greeting.json`\nContracts: `format-1`\nBlocked by: none');

    expect(records.gate(x.workId).current).toBe(true);
    expect(() => records.buildReadiness(x.workId, { limit: 2 })).toThrow(/overlap.*blocker/i);
    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({ kind: 'overlap', requiresFix: true }),
    );
    write(
        b09.workId,
        'brief',
        `Files: \`fixtures/greeting.json\`\nContracts: \`format-1\`\nBlocked by: \`${x.workId}\`\nNo ordering needed: \`format-1\`: file ordering covers the envelope.`,
    );
    records.syncBlockers(g.workId, revisions());
    expect(records.gate(x.workId)).toMatchObject({ current: true, evidence });

    const consumer = part(
        'b10 proof',
        `## What\nProve \`${b09.workId}\` output.\nBlocked by: none\nNo ordering needed: \`${b09.workId}\`: local contract proof.`,
    );

    approve(consumer.workId);
    write(b09.workId, 'brief', `Changed output.\nBlocked by: \`${x.workId}\``);
    expect(records.gate(consumer.workId).current).toBe(false);
});

test('S06: b06 cannot retire before the decision naming it answers; holds survive refusal', async () => {
    const { records, part, write } = await fixture();
    const b06 = part('b06 endpoint candidate', 'Endpoint proposal.');
    const b08 = part('b08 legacy proof', 'Legacy proof.');

    records.addBlocker(b08.workId, b08.revision, b06.workId);

    const d3 = part('D3 retain endpoint?', `Method: grill\nKeep \`${b06.workId}\`?`, 'decision');
    const plan = () => [
        {
            workId: b08.workId,
            revision: records.read(b08.workId).revision,
            action: 'remove' as const,
            reason: 'Endpoint obsolete.',
        },
    ];

    expect(() => records.setAside(b06.workId, records.read(b06.workId).revision, plan())).toThrow(
        /unanswered decision/i,
    );
    expect(records.read(b06.workId).setAside).toBe(false);
    expect(records.blockers(b08.workId).map((r) => r.workId)).toEqual([b06.workId]);
    expect(records.setAsideHistory(b06.workId)).toEqual([]);
    expect(() =>
        records.mergeBuild(b06.workId, records.read(b06.workId).revision, {
            into: b08.workId,
            revisions: Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision])),
        }),
    ).toThrow(/unanswered decision/i);
    write(d3.workId, 'answer', 'Use fragment, retire endpoint.');
    records.setAside(b06.workId, records.read(b06.workId).revision, plan());
    expect(records.read(b06.workId).setAside).toBe(true);
});

test('S06: work-order distinguishes b04 merged into survivor from b06 set aside', async () => {
    const { records, g, part, revisions } = await fixture();
    const b04 = part('b04 loader', 'Load.');
    const b05 = part('b05 read and show', 'Render.');
    const b06 = part('b06 endpoint', 'Endpoint.');

    records.mergeBuild(b04.workId, b04.revision, { into: b05.workId, revisions: revisions() });
    records.setAside(b06.workId, records.read(b06.workId).revision);

    const rows = workOrder(records, g.workId);

    expect(rows.find((r) => r.workId === b04.workId)?.waits).toContain('Merged into b05 read and show.');
    expect(rows.find((r) => r.workId === b06.workId)?.waits).toContain('Set aside.');
    expect(workOrderReport(rows)).toContain('Merged into b05 read and show.');
});
