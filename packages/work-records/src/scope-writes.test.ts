import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { agentWrites } from './agent-writes.ts';
import { scopeMarkdown, type BriefScope } from './brief-scope.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const stores: WorkRecords[] = [];
const scope: BriefScope = {
    files: ['cli.js'],
    tests: [],
    behaviour: ['Greet the first argument.'],
    excluded: [],
    size: 'Small',
    verify: { required: false, visibleUi: null },
};
const fixture = async (upgrade = false) => {
    const dir = mkdtempSync(join(tmpdir(), 'scope-writes-'));

    dirs.push(dir);

    const path = join(dir, 'records.db');

    if (upgrade) {
        // Schema 37 includes main's batch gates and predates confirmed scope.
        const legacy = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 37) });

        expect(legacy.db.prepare('PRAGMA table_info(brief_gates)').all()).toContainEqual(
            expect.objectContaining({ name: 'batch_digest' }),
        );
        legacy.write(() =>
            legacy.db.exec(`
            INSERT INTO work_records(work_id,repository,kind,status,revision,created_at,updated_at,title,initial_context)
              VALUES('legacy','test/app','build','Shaping',1,'now','now','Legacy','');
            INSERT INTO brief_gates(gate_id,work_id,source_revision,brief_digest,approved_by,evidence,recorded_at,batch_digest)
              VALUES('legacy-gate','legacy',1,'legacy-brief','Pedro','Yes.','now','legacy-batch');
        `),
        );
        legacy.close();
    }

    const records = await openWorkRecords(path);
    const other = await openWorkRecords(path);

    stores.push(records, other);

    const work = records.create({ title: 'CLI greeting', repository: 'test/app', kind: 'feature' });
    const agent = agentWrites(records);

    return { records, other, work, agent };
};

afterEach(() => {
    vi.restoreAllMocks();
    for (const records of stores.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('upgrades main schema before capturing scope and recording a batch gate', async () => {
    const { records, work, agent } = await fixture(true);

    expect(records.confirmedScope('legacy')).toBeNull();
    expect(records.gate('legacy').evidence).toContainEqual(expect.objectContaining({ batchDigest: 'legacy-batch' }));
    agent.confirmScope(work.workId, work.revision, scope, 'Pedro', 'Yes.');
    records.setBody(work.workId, records.read(work.workId).revision, 'brief', scopeMarkdown(scope));

    const input = records.doubtPackage(work.workId);

    expect(input.source.confirmedScope).toEqual(scope);
    records.recordDoubt(work.workId, input.packageDigest, 'Doubt', 'Checked scope.', []);

    const manifest = records.gateBatch([work.workId]);

    records.recordGateBatch(manifest, manifest.digest, 'Pedro', 'Yes.');
    expect(records.gate(work.workId).passing?.batchDigest).toBe(manifest.digest);
    expect(() => records.writeRevision(work.workId, work.revision, ['confirmedScope'])).toThrow(/confirmedScope/);
});

it('retries scope confirmation after unrelated progress, including a race during the write', async () => {
    const { records, other, work, agent } = await fixture();
    const strict = records.confirmScope.bind(records);

    other.setNeedsYou(work.workId, work.revision, 'Keep this note.');
    vi.spyOn(records, 'confirmScope').mockImplementationOnce((id, revision, input, by, response) => {
        other.update(id, revision, { status: 'Shaping' });

        return strict(id, revision, input, by, response);
    });
    expect(agent.confirmScope(work.workId, work.revision, scope, 'Pedro', 'Yes.').scope).toEqual(scope);
    expect(records.read(work.workId)).toMatchObject({ status: 'Shaping', needsYou: 'Keep this note.' });
});

it.each(['title', 'confirmedScope', 'gate'] as const)(
    'refuses scope confirmation after concurrent %s changes',
    async (field) => {
        const { records, other, work, agent } = await fixture();
        const start =
            field === 'gate' ? records.setBody(work.workId, work.revision, 'brief', scopeMarkdown(scope)) : work;

        if (field === 'title') other.retitle(work.workId, start.revision, 'Different understanding');
        else if (field === 'confirmedScope') other.confirmScope(work.workId, start.revision, scope, 'Pedro', 'Yes.');
        else {
            const waiting = other.setNeedsYou(work.workId, start.revision, 'Approve this brief.');

            other.recordGate(work.workId, waiting.revision, {
                briefDigest: other.gate(work.workId).briefDigest!,
                approvedBy: 'Pedro',
                evidence: 'Yes.',
            });
        }

        const before = records.read(work.workId);

        expect(() =>
            agent.confirmScope(work.workId, start.revision, { ...scope, size: 'Larger' }, 'Pedro', 'Yes.'),
        ).toThrow(new RegExp(`conflicting fields:.*${field}`));
        expect(records.read(work.workId)).toEqual(before);
        expect(records.confirmedScope(work.workId)?.scope.size).not.toBe('Larger');
    },
);

it('refuses single displayed approval after scope is amended and restored', async () => {
    const { records, work, agent } = await fixture();

    agent.confirmScope(work.workId, work.revision, scope, 'Pedro', 'Yes.');
    records.setBody(work.workId, records.read(work.workId).revision, 'brief', scopeMarkdown(scope));

    const input = records.doubtPackage(work.workId);

    records.recordDoubt(work.workId, input.packageDigest, 'Doubt', 'Checked.', []);

    const display = agent.displayGate(work.workId);

    records.confirmScope(
        work.workId,
        records.read(work.workId).revision,
        { ...scope, size: 'Larger' },
        'Pedro',
        'Larger.',
    );
    records.confirmScope(work.workId, records.read(work.workId).revision, scope, 'Pedro', 'Small again.');
    expect(() => agent.recordDisplayedGate(display, display.approvalDigest, 'Pedro', 'Yes.')).toThrow(/requires Pedro/);
    expect(records.gate(work.workId).evidence).toEqual([]);
});
