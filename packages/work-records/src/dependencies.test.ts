import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkKind, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-records-dependencies-'));

    dirs.push(dir);

    return dir;
};
const open = async (path = join(tempDir(), 'work-records.db')) => {
    const records = await openWorkRecords(path);

    opened.push(records);

    return records;
};

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lar = (records: WorkRecords, kind: WorkKind) =>
    records.create({ title: 'Work', repository: 'maddec01/lar', kind });
const at = (records: WorkRecords, workId: string) => records.read(workId).revision;
const NEED = {
    need: 'A sign-in endpoint, so the board can log in.',
    owner: 'acme/auth',
    ticket: 'acme/auth#5',
    pullRequests: ['acme/auth#9'],
    handover: '# Handover\n\nPOST /sign-in.',
};

/** A concept owning a Dependency that blocks one of its builds. */
async function blockedBuild() {
    const records = await open();
    const [concept, build] = [lar(records, 'concept'), lar(records, 'build')];

    records.setParent(build.workId, 1, concept.workId);

    const added = records.addDependency(concept.workId, NEED);
    const dependency = records.addDependencyBlock(added.dependencyId, added.revision, build.workId);

    return { records, concept, build, dependency };
}

describe('Dependencies', () => {
    it('keeps a Dependency inside its work record across close and reopen', async () => {
        const path = join(tempDir(), 'work-records.db');
        const records = await openWorkRecords(path);
        const concept = lar(records, 'concept');
        const added = records.addDependency(concept.workId, {
            ...NEED,
            contract: 'Returns a session token.',
            evidence: 'The PR merges.',
        });

        expect(added).toMatchObject({
            workId: concept.workId,
            need: NEED.need,
            owner: 'acme/auth',
            contract: 'Returns a session token.',
            evidence: 'The PR merges.',
            ticket: 'acme/auth#5',
            pullRequests: ['acme/auth#9'],
            handover: NEED.handover,
            met: null,
            needsReview: false,
            blocks: [],
            replacedBy: null,
            observations: [],
            revision: 1,
        });
        expect(records.read(concept.workId).revision).toBe(2);
        records.close();

        const reopened = await open(path);

        expect(reopened.dependency(added.dependencyId)).toEqual(added);
        expect(reopened.dependencies(concept.workId)).toEqual([added]);
    });

    it('updates its fields with the current revision and refuses a stale one', async () => {
        const records = await open();
        const added = records.addDependency(lar(records, 'build').workId, NEED);
        const updated = records.updateDependency(added.dependencyId, 1, {
            contract: 'Returns a token.',
            ticket: null,
            pullRequests: [],
        });

        expect(updated).toMatchObject({
            contract: 'Returns a token.',
            ticket: null,
            pullRequests: [],
            handover: NEED.handover,
            revision: 2,
        });
        expect(() => records.updateDependency(added.dependencyId, 1, { need: 'Other' })).toThrow(
            expect.objectContaining({ code: 'stale-revision' }),
        );
        expect(() => records.updateDependency(added.dependencyId, 2, { pullRequests: ['nope'] })).toThrow(
            expect.objectContaining({ code: 'invalid' }),
        );
        expect(records.dependency(added.dependencyId)).toEqual(updated);
    });

    it('holds its builds until the user marks it met; an external close or merge never does', async () => {
        const { records, build, dependency } = await blockedBuild();
        const id = dependency.dependencyId;
        const waiting = [{ dependencyId: id, reasons: ["It isn't marked met."] }];

        expect(records.waitingOn(build.workId)).toEqual(waiting);
        expect(records.observeDependency(id, 2, { subject: 'acme/auth#5', kind: 'closed' }).met).toBeNull();
        expect(records.observeDependency(id, 3, { subject: 'acme/auth#9', kind: 'merged' }).met).toBeNull();
        expect(records.waitingOn(build.workId)).toEqual(waiting);
        records.setPullRequest(build.workId, at(records, build.workId), 'maddec01/lar#1');
        records.observe(build.workId, at(records, build.workId), { of: 'pr', state: 'merged' });
        expect(records.completion(build.workId)).toEqual({
            complete: false,
            reasons: [`Its Dependency ${id} on acme/auth isn't met.`],
        });

        const met = records.markDependencyMet(id, 4, 'pedro');

        expect(met).toMatchObject({ met: { by: 'pedro', at: expect.any(String) }, needsReview: false, revision: 5 });
        expect(records.waitingOn(build.workId)).toEqual([]);
        expect(records.completion(build.workId).complete).toBe(true);
        expect(records.clearDependencyMet(id, 5).met).toBeNull();
        expect(records.waitingOn(build.workId)).toEqual(waiting);
    });

    it('keeps a met Dependency met when an observation changes, and flags it for review', async () => {
        const { records, build, dependency } = await blockedBuild();
        const id = dependency.dependencyId;

        records.observeDependency(id, 2, { subject: 'acme/auth#9', kind: 'merged' });
        records.markDependencyMet(id, 3, 'pedro');
        expect(records.observeDependency(id, 4, { subject: 'acme/auth#9', kind: 'merged' }).needsReview).toBe(false);

        const changed = records.observeDependency(id, 5, { subject: 'acme/auth#9', kind: 'reopened' });

        expect(changed).toMatchObject({ met: { by: 'pedro' }, needsReview: true });
        expect(changed.observations).toEqual([
            { subject: 'acme/auth#9', kind: 'reopened', detail: null, observedAt: expect.any(String), lastGood: null },
        ]);
        expect(records.waitingOn(build.workId)).toEqual([]);
        expect(records.markDependencyMet(id, 6, 'pedro')).toMatchObject({ needsReview: false });
    });

    it('swaps its blocker references on every dependent build for a named build in one transaction', async () => {
        const { records, concept, build, dependency } = await blockedBuild();
        const [second, replacement] = [lar(records, 'build'), lar(records, 'build')];

        records.setParent(second.workId, 1, concept.workId);

        const id = dependency.dependencyId;

        records.addDependencyBlock(id, 2, second.workId);
        records.markDependencyMet(id, 3, 'pedro');

        const replaced = records.replaceDependencyWithBuild(id, 4, replacement.workId);

        expect(replaced).toMatchObject({
            blocks: [],
            replacedBy: replacement.workId,
            met: { by: 'pedro' },
            handover: NEED.handover,
        });
        for (const dependent of [build, second]) {
            expect(records.blockers(dependent.workId).map((record) => record.workId)).toEqual([replacement.workId]);
            expect(records.waitingOn(dependent.workId)).toEqual([
                { workId: replacement.workId, reasons: ['It has no recorded PR.'] },
            ]);
        }
    });

    it('rolls the whole replacement back when one dependent would close a cycle', async () => {
        const { records, concept, build, dependency } = await blockedBuild();
        const [second, replacement] = [lar(records, 'build'), lar(records, 'build')];

        records.setParent(second.workId, 1, concept.workId);

        const id = dependency.dependencyId;

        records.addDependencyBlock(id, 2, second.workId);
        records.addBlocker(replacement.workId, 1, second.workId);

        const before = {
            dependency: records.dependency(id),
            build: records.read(build.workId),
            second: records.read(second.workId),
        };

        expect(() => records.replaceDependencyWithBuild(id, 3, replacement.workId)).toThrow('cycle');
        expect(() => records.replaceDependencyWithBuild(id, 3, lar(records, 'slice').workId)).toThrow('build');
        expect(records.dependency(id)).toEqual(before.dependency);
        expect(records.read(build.workId)).toEqual(before.build);
        expect(records.read(second.workId)).toEqual(before.second);
        expect(records.blockers(build.workId)).toEqual([]);
    });

    it('survives retention while unmet: a due record holding or blocked by an unmet Dependency is kept', async () => {
        const { records, concept, build, dependency } = await blockedBuild();

        records.setAside(build.workId, at(records, build.workId));
        records.setAside(concept.workId, at(records, concept.workId));

        const later = new Date(Date.now() + 31 * 86_400_000);

        expect(records.deleteExpired({ hideAfterDays: 7, deleteAfterDays: 30 }, later)).toEqual({
            deleted: [],
            kept: [
                { workId: concept.workId, reason: `It holds the unmet Dependency ${dependency.dependencyId}.` },
                { workId: build.workId, reason: `The unmet Dependency ${dependency.dependencyId} blocks it.` },
            ],
        });
        expect(records.dependency(dependency.dependencyId)).toMatchObject({
            handover: NEED.handover,
            blocks: [build.workId],
        });
    });
});

it('upgrades legacy closure evidence to pending without inventing a submitted proof', async () => {
    const path = join(tempDir(), 'work-records.db');
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, -1) });

    old.db.exec(`INSERT INTO work_records(work_id,title,repository,kind,status,revision,created_at,updated_at)
        VALUES ('g','Group','fake/a','concept','Shaping',1,'now','now');
        INSERT INTO dependencies(dependency_id,work_id,need,owner,contract,evidence,ticket,pull_requests,handover,revision,created_at,updated_at)
        VALUES ('d','g','Proof','External','','Closed with no proof attached.','fake/c#25','[]','',4,'now','now')`);
    old.close();

    const records = await open(path);

    expect(records.dependency('d')).toMatchObject({
        evidence: 'Closed with no proof attached.',
        proofState: 'pending',
        met: null,
        revision: 4,
    });
});
