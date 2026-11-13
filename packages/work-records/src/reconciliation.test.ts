import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

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

    const part = (n: number, kind: 'decision' | 'build') =>
        records.createPart({
            parentId: group.workId,
            parentRevision: records.read(group.workId).revision,
            repository: ['fake/platform', 'fake/server', 'fake/app'][n % 3]!,
            title: `${kind} ${n}`,
            kind,
            body:
                kind === 'decision'
                    ? 'Method: grill\nChoose connection policy.'
                    : `## What\nReconnect ${n}.\nFiles: \`src/${n}.ts\`\nContracts: \`connection-${n}\``,
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

test('cross-repository contract and same-repository file overlap need an edge or current Doubt explanation', async () => {
    const { records, group, builds, review } = await fixture();

    for (const n of [0, 2, 3])
        records.setBody(
            builds[n]!.workId,
            records.read(builds[n]!.workId).revision,
            'brief',
            'Files: `ConnectionManager.swift`\nContracts: `server-replacement`',
        );

    let result = records.reconcile(group.workId);

    expect(result.items.filter((i) => i.kind === 'overlap')).toHaveLength(3);

    const zero = builds[0]!.workId,
        two = builds[2]!.workId;

    records.addBlocker(two, records.read(two).revision, zero);
    result = records.reconcile(group.workId);
    expect(result.items.filter((i) => i.kind === 'overlap')).toHaveLength(2);
    review();
    expect(records.reconcile(group.workId).items.filter((i) => i.kind === 'overlap')).toEqual([]);
}, 20000);

test('ships-with is a release step, survives PR merges and reopens after member set-aside', async () => {
    const { records, group, builds, clean } = await fixture();
    const ids = [builds[1]!.workId, builds[2]!.workId];
    const step = {
        id: 'invite-links',
        title: 'Release server and app together',
        kind: 'ships-with' as const,
        workIds: ids,
        evidence: null,
    };

    setSteps(records, group.workId, records.read(group.workId).revision, [step]);
    expect(() => setSteps(records, group.workId, 1, [step])).toThrow(/parent changed/);
    expect(records.reconcile(group.workId).items.some((i) => i.kind === 'release')).toBe(true);
    clean();
    for (const id of ids) {
        records.setPullRequest(id, records.read(id).revision, `${records.read(id).repository}#99`);
        records.observe(id, records.read(id).revision, { of: 'pr', state: 'merged' });
    }
    expect(records.reconcile(group.workId).items).toContainEqual(
        expect.objectContaining({ key: 'release-evidence:invite-links' }),
    );
    setSteps(records, group.workId, records.read(group.workId).revision, [
        { ...step, evidence: 'Both release versions verified live.' },
    ]);
    expect(records.reconcile(group.workId).items.some((i) => i.key === 'release-evidence:invite-links')).toBe(false);

    const third = builds[4]!.workId;

    setSteps(records, group.workId, records.read(group.workId).revision, [{ ...step, workIds: [ids[0]!, third] }]);
    records.setAside(third, records.read(third).revision, []);
    expect(records.reconcile(group.workId).items).toContainEqual(
        expect.objectContaining({ key: 'release-members:invite-links' }),
    );
}, 20000);

test('changed Dependencies and map progress are listed even after a merged PR', async () => {
    const { records, group, builds, clean } = await fixture();
    const dependency = records.addDependency(group.workId, {
        need: 'DNS and portal activation',
        owner: 'Hosting',
        contract: 'CORS headers present',
    });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, builds[0]!.workId);
    clean();
    records.updateDependency(dependency.dependencyId, records.dependency(dependency.dependencyId).revision, {
        contract: 'CORS and replacement fields present',
    });

    const id = builds[9]!.workId;

    records.setPullRequest(id, records.read(id).revision, 'fake/platform#12');
    records.observe(id, records.read(id).revision, { of: 'pr', state: 'merged' });

    const report = records.reconcile(group.workId);

    expect(report.items).toContainEqual(
        expect.objectContaining({
            key: `dependency:${dependency.dependencyId}`,
            changes: expect.arrayContaining(['contract']),
        }),
    );
    expect(report.items).toContainEqual(
        expect.objectContaining({ key: `map:${id}`, changes: expect.arrayContaining(['finishedAt']) }),
    );
}, 20000);

function setSteps(
    records: import('./work-records.ts').WorkRecords,
    id: string,
    revision: number,
    steps: import('@lar-factory/shared/group-reconciliation').ReleaseStep[],
) {
    records.setReleasePlan(id, revision, {
        steps: steps.map((s) => ({
            id: s.id,
            who: 'Fixture release owner',
            what: s.title,
            ...(s.kind === 'ships-with' ? { shipsWith: s.workIds } : {}),
        })),
        outcomeCheck: 'Every app reconnects and invitation links work.',
    });
    for (const step of steps)
        if (step.evidence)
            records.completeReleaseStep(id, records.read(id).revision, step.id, 'Fixture release owner', step.evidence);

    return records.releaseSteps(id);
}
