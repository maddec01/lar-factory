import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { scopeMarkdown, type BriefScope } from './brief-scope.ts';
import { gateManifest } from './gate-batch.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const scopeFor = (index: number): BriefScope => ({
    files: [`src/part-${index}.ts`],
    tests: [],
    behaviour: [`Complete brief ${index}.`],
    excluded: [],
    size: 'Small',
    verify: { required: false, visibleUi: null },
});

async function fixture(captured = false) {
    const dir = mkdtempSync(join(tmpdir(), 'gate-batch-'));
    const path = join(dir, 'records.db');
    const records = await openWorkRecords(path);

    opened.push({ records, dir });

    const ids: string[] = [];

    for (let i = 0; i < 8; i++) {
        const work = records.create({
            title: `Build ${i}`,
            repository: 'fake/app',
            ticket: `fake/app#${i + 1}`,
            kind: 'build',
        });

        records.setBody(
            work.workId,
            work.revision,
            'brief',
            completeBrief(`Complete brief ${i}.\nFiles: \`src/part-${i}.ts\``),
        );

        if (captured) {
            records.confirmScope(work.workId, records.read(work.workId).revision, scopeFor(i), 'Pedro', 'Yes.');
            records.setBody(
                work.workId,
                records.read(work.workId).revision,
                'brief',
                completeBrief(scopeMarkdown(scopeFor(i))),
            );
        }

        ids.push(work.workId);
    }

    const review = () => {
        for (const id of ids) {
            const input = records.doubtPackage(id);

            records.recordDoubt(
                id,
                input.packageDigest,
                `Doubt ${id}`,
                'All findings resolved; code evidence checked.',
                [],
            );
        }
    };

    review();

    const approve = (manifest = records.gateBatch(ids)) =>
        records.recordGateBatch(manifest, manifest.digest, 'Pedro', 'Yes to this displayed batch, response 42.');
    const empty = () => {
        for (const id of ids) {
            expect(records.gate(id).evidence).toEqual([]);
            expect(records.specState(id).pending).toBeNull();
        }
    };

    return { records, ids, path, review, approve, empty };
}

it('approves eight complete briefs with one manifest digest and one response', async () => {
    const { records, ids, approve } = await fixture();
    const manifest = records.gateBatch(ids);

    expect(manifest.members).toHaveLength(8);
    expect(manifest.members[0]).toMatchObject({
        display: {
            brief: expect.stringContaining('Complete brief'),
            briefDigest: expect.any(String),
            approvalDigest: expect.any(String),
        },
        doubt: { identity: expect.any(String), reviewId: expect.any(String) },
    });

    const result = approve(manifest);

    expect(result.gates).toHaveLength(8);
    for (const id of ids) {
        expect(records.gate(id).passing).toMatchObject({
            batchDigest: manifest.digest,
            approvedBy: 'Pedro',
            evidence: 'Yes to this displayed batch, response 42.',
        });
        expect(records.specState(id).pending).toBe(records.body(id, 'brief'));
    }
});

it.each(['brief', 'kind', 'Doubt'] as const)(
    'rejects the entire batch after a member %s changes; renewed approval succeeds',
    async (change) => {
        const { records, ids, review, approve, empty } = await fixture();
        const manifest = records.gateBatch(ids);
        const id = ids.at(-1)!;
        const work = records.read(id);

        if (change === 'brief') records.setBody(id, work.revision, 'brief', completeBrief('One changed word.'));
        else if (change === 'kind') {
            const bug = records.update(id, work.revision, { kind: 'bug' });

            records.setBody(
                id,
                bug.revision,
                'brief',
                completeBrief(
                    '## Done when\nComplete the bug fix.\n## Scope\n### Files\n`src/part-7.ts`\n## Cause\nA stale value.\n## Evidence\nReproduction returns the stale value.\n## Regression test\n`test/part.test.ts`: rejects stale values.\n## Red-before-green\nFails before the fix, then passes.',
                ),
            );
        } else {
            const input = records.doubtPackage(id);

            records.recordDoubt(id, input.packageDigest, 'Fresh Doubt', 'New review result.', []);
        }

        expect(() => approve(manifest)).toThrow(/changed|Doubt|conflicting fields/);
        empty();
        review();
        expect(approve().gates).toHaveLength(8);
    },
);

it('rejects a word changed only in the displayed copy, duplicate members and the wrong approved digest', async () => {
    const { records, ids, approve, empty } = await fixture();
    const manifest = records.gateBatch(ids);
    const edited = structuredClone(manifest);

    edited.members[0]!.display.brief += ' Edited.';
    expect(() => approve(edited)).toThrow(/manifest changed/);
    expect(() => approve(gateManifest([manifest.members[0]!, manifest.members[0]!]))).toThrow(/duplicate/);
    expect(() => records.recordGateBatch(manifest, 'wrong', 'Pedro', 'Yes')).toThrow(/digest/);
    empty();
});

it('rolls back all gates and Spec outboxes if the final gate write fails', async () => {
    const { ids, path, approve, empty } = await fixture();
    const db = new DatabaseSync(path);

    try {
        db.exec(
            `CREATE TRIGGER refuse_last_gate BEFORE INSERT ON brief_gates WHEN NEW.work_id = '${ids.at(-1)!}' BEGIN SELECT RAISE(ABORT, 'injected final gate failure'); END;`,
        );
        expect(() => approve()).toThrow(/injected final gate failure/);
        empty();
        db.exec('DROP TRIGGER refuse_last_gate');
        expect(approve().gates).toHaveLength(8);
    } finally {
        db.close();
    }
});

it('rechecks held Spec edits inside the batch transaction even when the brief revision is unchanged', async () => {
    const { records, ids, approve, empty } = await fixture();
    const manifest = records.gateBatch(ids);
    const id = ids.at(-1)!;
    const state = records.specState(id);

    records.saveSpecState(id, state.generation, {
        ...state,
        held: { body: 'Unverified edit', title: 'Changed', version: 'v2', digest: 'remote' },
    });
    expect(() => approve(manifest)).toThrow(/held Spec edit/);
    empty();

    const held = records.specState(id);

    records.saveSpecState(id, held.generation, { ...held, held: null });
    expect(approve(manifest).gates).toHaveLength(8);
});

it('preserves one approved manifest through all members waiting, resuming and receiving observations', async () => {
    const { records, ids, approve } = await fixture();
    const manifest = records.gateBatch(ids);

    for (const id of ids) {
        const waiting = records.waitForUser(id, records.read(id).revision, 'Should search match whole words?');
        const observed = records.observe(id, waiting.revision, { of: 'ticket', state: 'open' });

        records.resumeFromUser(id, observed.revision, 'Shaping');
    }

    const result = approve(manifest);

    expect(result.digest).toBe(manifest.digest);
    expect(result.manifest).toEqual(manifest);
    for (const member of manifest.members) {
        expect(records.gate(member.display.workId).passing).toMatchObject({
            batchDigest: manifest.digest,
            approvalDigest: member.display.approvalDigest,
        });
        expect(records.read(member.display.workId)).toMatchObject({ status: 'Ready', needsYou: null });
    }
});

it('rejects the whole batch after an edited brief is restored and Doubt renewed', async () => {
    const { records, ids, review, approve, empty } = await fixture();
    const manifest = records.gateBatch(ids);
    const id = ids.at(-1)!;
    const brief = records.body(id, 'brief')!;
    const changed = records.setBody(id, records.read(id).revision, 'brief', completeBrief('Changed scope.'));

    records.setBody(id, changed.revision, 'brief', completeBrief(brief));
    review();
    expect(() => approve(manifest)).toThrow(/conflicting fields: body.brief/);
    empty();
});

it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    'checks captured scope for batch member %s before display and approval',
    async (index) => {
        const { records, ids, review, approve, empty } = await fixture(true);
        const manifest = records.gateBatch(ids);
        const id = ids[index]!;
        const amended = { ...scopeFor(index), excluded: ['No README examples.'] };

        records.confirmScope(id, records.read(id).revision, amended, 'Pedro', 'Exclude README examples.');
        review();
        expect(() => records.gateBatch(ids)).toThrow(/brief differs from confirmed scope/);
        expect(() => approve(manifest)).toThrow(/conflicting fields:.*confirmedScope/);
        empty();
        records.setBody(id, records.read(id).revision, 'brief', completeBrief(scopeMarkdown(amended)));
        review();
        expect(approve().gates).toHaveLength(8);
    },
);

it('rejects batch approval after captured scope is amended and restored, even with renewed Doubt', async () => {
    const { records, ids, review, approve, empty } = await fixture(true);
    const manifest = records.gateBatch(ids);
    const id = ids.at(-1)!;
    const original = scopeFor(7);

    records.confirmScope(id, records.read(id).revision, { ...original, size: 'Larger' }, 'Pedro', 'Larger.');
    records.confirmScope(id, records.read(id).revision, original, 'Pedro', 'Small again.');
    review();
    expect(() => approve(manifest)).toThrow(/conflicting fields:.*confirmedScope/);
    empty();
    expect(approve().gates).toHaveLength(8);
});
