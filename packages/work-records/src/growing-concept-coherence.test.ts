import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
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

    return { records, dir, g, part, write, revisions };
}

test('S06 A01: a shared Contracts name orders nothing until one brief declares Produces', async () => {
    const { records, g, part, write, revisions } = await fixture();
    const producer = part('b02 producer', 'Contracts: `greeting-message-v1`\nBlocked by: none');
    const x = part('x envelope', 'Blocked by: none');
    const consumer = part('b09 fixture', `Contracts: \`greeting-message-v1\`\nBlocked by: \`${x.workId}\``);

    records.addBlocker(consumer.workId, records.read(consumer.workId).revision, x.workId);
    expect(records.reconcile(g.workId).items.filter((i) => i.kind === 'blocker')).toEqual([]);
    records.syncBlockers(g.workId, revisions());
    expect(records.blockers(consumer.workId).map((r) => r.workId)).toEqual([x.workId]);
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

test('S06 A01: a Consumes line naming no single build holds reconciliation and sync-blockers', async () => {
    const { records, g, part, revisions } = await fixture();
    const consumer = part('b09 fixture', 'Consumes: `missing producer`\nBlocked by: none');

    expect(records.reconcile(g.workId).items).toContainEqual(
        expect.objectContaining({
            key: `contract-source:${consumer.workId}:Consumes: missing producer`,
            workId: consumer.workId,
            kind: 'blocker',
            requiresFix: true,
        }),
    );
    expect(() => records.syncBlockers(g.workId, revisions())).toThrow(/Consumes: missing producer/);
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
