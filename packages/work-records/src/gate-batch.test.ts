import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { scopeMarkdown, type BriefScope } from './brief-scope.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const scopeFor = (index: number): BriefScope => ({
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

it('rejects the entire batch after a member brief changes; renewed approval succeeds', async () => {
    const { records, ids, review, approve, empty } = await fixture();
    const manifest = records.gateBatch(ids);
    const id = ids.at(-1)!;

    records.setBody(id, records.read(id).revision, 'brief', completeBrief('One changed word.'));
    expect(() => approve(manifest)).toThrow(/changed|conflicting fields/);
    empty();
    review();
    expect(approve().gates).toHaveLength(8);
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

it('checks captured scope for a batch member before display and approval', async () => {
    const { records, ids, review, approve, empty } = await fixture(true);
    const manifest = records.gateBatch(ids);
    const id = ids.at(-1)!;
    const amended = { ...scopeFor(7), excluded: ['No README examples.'] };

    records.confirmScope(id, records.read(id).revision, amended, 'Pedro', 'Exclude README examples.');
    review();
    expect(() => records.gateBatch(ids)).toThrow(/brief differs from confirmed scope/);
    expect(() => approve(manifest)).toThrow(/conflicting fields:.*confirmedScope/);
    empty();
    records.setBody(id, records.read(id).revision, 'brief', completeBrief(scopeMarkdown(amended)));
    review();
    expect(approve().gates).toHaveLength(8);
});
