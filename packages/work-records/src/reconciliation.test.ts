import { reconcileWaitItems } from '@lar-factory/shared/group-reconciliation';
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

            records.recordDoubt(b.workId, pkg.packageDigest, 'Doubt', 'Code, answers and sibling contracts agree.');
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

test('briefs naming the same files and contracts raise no ordering item', async () => {
    const { records, group, builds, review } = await fixture();
    const [first, second] = builds as [WorkRecord, WorkRecord];

    records.setBody(
        second.workId,
        records.read(second.workId).revision,
        'brief',
        records.body(first.workId, 'brief')!.replace('Reconnect 0.', 'Reconnect again.'),
    );
    review();
    expect(records.reconcile(group.workId).items.map((item) => item.key)).not.toContainEqual(
        expect.stringMatching(/^overlap:/),
    );
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

/** A linked group of two builds with PRs and a Pedro release step, reconciled clean. */
async function linked(release: 'step' | 'ships-with' | 'none' = 'none') {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-merge-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    opened.push({ records, dir });

    const group = records.create({
        title: 'Group',
        repository: 'fake/app',
        kind: 'feature',
        status: 'In progress',
    }).workId;
    const at = (id = group) => records.read(id).revision;

    records.addThread(group, at(), 'group-owner', 'shape');

    const part = (n: number) => {
        const id = records.createPart({
            parentId: group,
            parentRevision: at(),
            title: `Part ${n}`,
            repository: 'fake/app',
            kind: 'build',
            body: `## What\nPart ${n}.\nBlocked by: none`,
            blockerIds: [],
        }).workId;

        records.setPullRequest(id, at(id), `fake/app#${n}`);

        return id;
    };
    const [first, second] = [part(1), part(2)] as [string, string];

    if (release !== 'none')
        records.setReleasePlan(group, at(), {
            steps:
                release === 'step'
                    ? [{ id: 'activate', who: 'Pedro', what: 'Activate' }]
                    : [{ id: 'ship', who: 'Agent', what: 'Ship together', shipsWith: [first, second] }],
            outcomeCheck: 'Check the merged parts together.',
        });

    const settle = () => {
        for (const id of [first, second]) {
            const pkg = records.doubtPackage(id);

            if (!records.currentDoubt(id)) records.recordDoubt(id, pkg.packageDigest, 'Doubt', 'Briefs agree.');
        }

        let report = records.reconcile(group);

        for (const item of report.items.filter((i) => !i.requiresFix))
            report = records.resolveReconcile(group, item.key, item.digest, 'Checked.');

        return report;
    };

    expect(settle().items.map((i) => i.summary)).toEqual([]);

    const merge = (id: string) => records.observe(id, at(id), { of: 'pr', state: 'merged' });
    const waits = () => reconcileWaitItems(records.reconciliation(group));

    return { records, group, first, second, at, merge, waits, settle };
}

test('after a part merges, the board pass resolves lifecycle-only items, including a sibling at Verify', async () => {
    const { records, group, first, second, at, merge, waits } = await linked();

    records.update(second, at(second), { status: 'Verify' });
    expect(records.reconcileAfterMerge(group)).toBeNull();
    merge(first);

    const report = records.reconcileAfterMerge(group)!;

    expect(report.items.filter((i) => i.key.startsWith('map:'))).toEqual([]);
    expect(report.completed).toContainEqual(
        expect.objectContaining({ key: `map:${first}`, evidence: expect.stringContaining('fake/app#1') }),
    );
    expect(waits()).toEqual([]);
    expect(records.reconcileAfterMerge(group)).toBeNull();
});

test('an item whose brief also changed stays open after the pass and waits', async () => {
    const { records, group, first, second, at, merge, waits } = await linked();

    records.setBody(second, at(second), 'brief', '## What\nPart 2, changed.\nBlocked by: none');
    merge(first);
    records.reconcileAfterMerge(group);

    expect(waits()).toContainEqual(expect.objectContaining({ key: `map:${second}`, changes: ['brief'] }));
    expect(waits().map((i) => i.key)).not.toContain(`map:${first}`);
    expect(records.reconcileAfterMerge(group)).toBeNull();
});

test('the last merge with a pending release step leaves only the release flow waiting', async () => {
    for (const release of ['step', 'ships-with'] as const) {
        const { records, group, first, second, merge, waits } = await linked(release);

        merge(first);
        merge(second);
        records.reconcileAfterMerge(group);

        expect(waits()).toEqual([]);

        if (release === 'ships-with')
            expect(records.reconciliation(group).pending).toContainEqual(
                expect.objectContaining({ key: 'release-evidence:ship' }),
            );
    }
});

test('recording release evidence or the Outcome check after the last merge leaves no wait', async () => {
    const { records, group, first, second, at, merge, waits, settle } = await linked('step');

    merge(first);
    merge(second);
    records.reconcileAfterMerge(group);
    records.completeReleaseStep(group, at(), 'activate', 'Pedro', 'Activated.');
    records.reconcile(group);
    expect(records.reconciliation(group).pending).toContainEqual(
        expect.objectContaining({ key: 'release:activate', changes: ['evidence'] }),
    );
    expect(waits()).toEqual([]);

    const run = records.prepareOutcomeCheck(group).run!;

    records.recordOutcomeCheck(group, at(), 'passed', 'Owner', 'Passed on merged SHAs.', run.digest);
    records.reconcile(group);
    expect(records.reconciliation(group).pending).toContainEqual(
        expect.objectContaining({ key: `release-outcome:${group}` }),
    );
    expect(waits()).toEqual([]);
    expect(settle().items).toEqual([]);
});

test('a sibling moving to Verify after the pass, with no new merge, raises no wait', async () => {
    const { records, group, first, second, at, merge, waits } = await linked();

    merge(first);
    records.reconcileAfterMerge(group);
    records.update(second, at(second), { status: 'Verify' });

    expect(records.reconcileAfterMerge(group)).toBeNull();
    records.reconcile(group);
    expect(waits()).toEqual([]);
});

test('a part added while another item is open runs the pass once it merges, and stays open as added', async () => {
    const { records, group, second, at, merge, waits } = await linked();

    records.setBody(second, at(second), 'brief', '## What\nPart 2, changed.\nBlocked by: none');
    records.reconcile(group);

    const third = records.createPart({
        parentId: group,
        parentRevision: at(),
        title: 'Part 3',
        repository: 'fake/app',
        kind: 'build',
        body: '## What\nPart 3.\nBlocked by: none',
        blockerIds: [],
    }).workId;

    records.setPullRequest(third, at(third), 'fake/app#3');
    records.reconcile(group);
    expect(records.reconcileAfterMerge(group)).toBeNull();
    merge(third);

    const report = records.reconcileAfterMerge(group)!;

    expect(report.items).toContainEqual(expect.objectContaining({ key: `map:${third}`, changes: ['added'] }));
    expect(waits().map((i) => i.key)).toEqual(expect.arrayContaining([`map:${second}`, `map:${third}`]));
    expect(records.reconcileAfterMerge(group)).toBeNull();
});
