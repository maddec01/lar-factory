import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords, type WorkRecord } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

/** The address-change audit: three repositories, three decisions, ten growing builds. */
async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    const group = records.create({
        title: 'Recover server connections after address changes',
        repository: 'fake/platform',
        kind: 'concept',
    });

    records.setBody(group.workId, group.revision, 'map', '## Destination\nReconnect safely.');

    const part = (n: number, kind: 'decision' | 'build'): WorkRecord =>
        records.createPart({
            parentId: group.workId,
            parentRevision: records.read(group.workId).revision,
            repository: ['fake/platform', 'fake/server', 'fake/app'][n % 3]!,
            title: `${kind} ${n}`,
            kind,
            body:
                kind === 'decision'
                    ? 'Method: grill\nChoose connection policy.'
                    : `Answers: \`${decisions[0]!.workId}\`\n## What\nReconnect ${n}.\nFiles: \`src/${n}.ts\`\nContracts: \`connection-${n}\`\nBlocked by: none`,
            blockerIds: [],
        });
    const decisions = [0, 1, 2].map((n) => part(n, 'decision'));

    for (const d of decisions)
        records.setBody(d.workId, records.read(d.workId).revision, 'answer', 'Use /lookup with replacementId.');
    for (const d of decisions) records.setBody(d.workId, records.read(d.workId).revision, 'domain-drafts', 'none');

    const builds = Array.from({ length: 10 }, (_, n) => part(n, 'build'));

    records.setBody(group.workId, records.read(group.workId).revision, 'map', '## Destination\nReconnect safely.');

    const review = () => {
        for (const b of builds.filter((b) => !records.read(b.workId).setAside)) {
            const pkg = records.doubtPackage(b.workId);

            records.recordDoubt(
                b.workId,
                pkg.packageDigest,
                'Doubt',
                'Code, answers and sibling contracts agree.',
                pkg.overlaps
                    .filter((o) => !o.ordered)
                    .map((o) => ({ otherWorkId: o.otherWorkId, reason: 'Compatible changes; no ordering needed.' })),
            );
        }
    };
    const clean = () => {
        review();
        records.refreshProjections(
            group.workId,
            Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision])),
            {
                map: records.body(group.workId, 'map')!,
                answers: Object.fromEntries(
                    decisions
                        .filter((d) => records.decisionAnswer(d.workId).current)
                        .map((d) => [d.workId, records.decisionAnswer(d.workId).current!.text]),
                ),
            },
        );

        let result = records.reconcile(group.workId);

        for (const item of result.items.filter((i) => !i.requiresFix))
            result = records.resolveReconcile(
                group.workId,
                item.key,
                item.digest,
                'Updated narrative and contracts; no other changes needed.',
            );

        return result;
    };

    clean();

    return { records, group, builds, decisions, review, clean, dir };
}

test('checklist is deterministic, live, persistent, exact-digest bound and returns to clean', async () => {
    const { records, group, builds, clean, dir } = await fixture();

    expect(records.reconciliation(group.workId).items).toEqual([]);

    const b = builds[3]!;

    records.retitle(b.workId, records.read(b.workId).revision, 'Changed scope title');

    const result = records.reconcile(group.workId);

    expect(result).toEqual(records.reconcile(group.workId));
    expect(result.items).toContainEqual(expect.objectContaining({ key: `map:${b.workId}`, changes: ['title'] }));

    const item = result.items.find((i) => !i.requiresFix)!;

    records.retitle(b.workId, records.read(b.workId).revision, 'Changed again');
    expect(() => records.resolveReconcile(group.workId, item.key, item.digest, 'Old review')).toThrow(/changed/);

    const reopened = await openWorkRecords(join(dir, 'records.db'));

    expect(reopened.reconciliation(group.workId)).toEqual(records.reconciliation(group.workId));
    reopened.close();
    expect(clean().items).toEqual([]);
    expect(records.reconcile(group.workId).completed.length).toBeGreaterThan(10);
}, 20000);

test('superseded endpoint, sibling contract removal and scope changes reopen Doubt and approved gates', async () => {
    const { records, group, builds, decisions, clean } = await fixture();
    const consumer = builds[2]!,
        provider = builds[0]!;

    records.recordGate(consumer.workId, records.read(consumer.workId).revision, {
        briefDigest: records.gate(consumer.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Board approved.',
    });
    clean();
    records.setBody(
        provider.workId,
        records.read(provider.workId).revision,
        'brief',
        'Remove /lookup and replacementId.\nContracts: `reconnect-v2`',
    );

    const old = decisions[0]!,
        replacement = decisions[1]!;

    records.setBody(
        replacement.workId,
        records.read(replacement.workId).revision,
        'answer',
        'Use /reconnect; /lookup is removed.',
    );
    records.supersedeAnswer(old.workId, records.read(old.workId).revision, {
        answerRevision: records.decisionAnswer(old.workId).current!.revision,
        by: {
            kind: 'decision',
            workId: replacement.workId,
            revision: records.read(replacement.workId).revision,
            answerRevision: records.decisionAnswer(replacement.workId).current!.revision,
        },
        affected: [],
    });

    const result = records.reconcile(group.workId);

    expect(result.items).toContainEqual(expect.objectContaining({ key: `gate:${consumer.workId}`, requiresFix: true }));
    expect(result.items).toContainEqual(
        expect.objectContaining({ key: `map:${old.workId}`, changes: expect.arrayContaining(['answer']) }),
    );
    expect(result.items).toContainEqual(expect.objectContaining({ key: `doubt:${consumer.workId}` }));

    const gate = result.items.find((i) => i.key === `gate:${consumer.workId}`)!;

    expect(() => records.resolveReconcile(group.workId, gate.key, gate.digest, 'Checked')).toThrow(
        /Fix the recorded condition/,
    );
    expect(
        records.doubtPackage(consumer.workId).decisions.find((d) => d.workId === old.workId)?.answer?.replacement?.text,
    ).toContain('/reconnect');
    expect(records.gate(consumer.workId).current).toBe(false);
}, 20000);
