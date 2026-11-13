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

const suggestions = [
    {
        title: 'Improve help',
        description: 'Explain reviewer evidence.',
        repository: 'owner/repo',
        kind: 'improvement' as const,
    },
];

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'retro-records-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ records, dir });

    let record = records.create({ title: 'Build', repository: 'owner/repo', kind: 'bug', status: 'Ready to merge' });
    const id = record.workId;

    record = records.setPullRequest(id, record.revision, 'owner/repo#1');
    record = records.addThread(id, record.revision, 'build-thread', 'build');
    records.setBuildPhase(id, record.revision, 'checks');

    const at = () => records.read(id).revision;
    const merge = () => {
        records.observe(id, at(), { of: 'pr', state: 'merged' });
        records.update(id, at(), { status: 'Done' });
    };

    return { records, id, at, merge, dir };
}

test('retro requires both Done and confirmation of the recorded delivery PR merge', async () => {
    const s = await setup();

    for (const status of ['Ready to merge', 'Needs you', 'Done', 'Verify'] as const) {
        s.records.update(s.id, s.at(), { status });
        expect(() => s.records.setBuildPhase(s.id, s.at(), 'retro')).toThrow(/confirmed merge/);
        expect(() => s.records.prepareRetro(s.id)).toThrow(/confirmed merge/);
    }
    s.merge();
    expect(s.records.prepareRetro(s.id)?.delivery.threadId).toBe('build-thread');
    expect(s.records.setBuildPhase(s.id, s.at(), 'retro').status).toBe('Done');
});

test('one complete proposal and board choice persist across connections with stable capture IDs', async () => {
    const s = await setup();

    s.merge();

    const prepared = s.records.prepareRetro(s.id)!;

    expect(s.records.read(s.id)).toMatchObject({ status: 'Done', buildPhase: 'retro' });

    expect(s.records.prepareRetro(s.id)).toEqual(prepared);

    const proposal = s.records.proposeRetro(s.id, s.at(), suggestions);

    expect(() => s.records.chooseRetro(s.id, s.at() - 1, [], 'Pedro')).toThrow(/revision|changed/i);
    for (const invalid of [[-1], [1], [0, 0], ['0']])
        expect(() => s.records.chooseRetro(s.id, s.at(), invalid as number[], 'Pedro')).toThrow(/listed/);
    expect(s.records.retro(s.id)?.choice).toBeNull();
    s.records.chooseRetro(s.id, s.at(), [0], 'Pedro');
    expect(() => s.records.chooseRetro(s.id, s.at(), [], 'Pedro')).toThrow(/awaiting/);
    expect(() => s.records.proposeRetro(s.id, s.at(), [])).toThrow(/already recorded/);

    const reopened = await openWorkRecords(join(s.dir, 'work.db'));

    try {
        expect(reopened.retro(s.id)).toMatchObject({
            suggestions,
            captures: proposal.captures,
            choice: { selected: [0], by: 'Pedro' },
        });
        expect(reopened.read(s.id).status).toBe('Done');
    } finally {
        reopened.close();
    }
});

test('an empty retro records no choice, while declining proposals records an explicit empty selection', async () => {
    const s = await setup();

    s.merge();
    s.records.prepareRetro(s.id);
    s.records.proposeRetro(s.id, s.at(), []);
    expect(s.records.retro(s.id)).toMatchObject({ suggestions: [], choice: null, captures: [] });
    expect(() => s.records.chooseRetro(s.id, s.at(), [], 'Pedro')).toThrow(/awaiting/);

    const t = await setup();

    t.merge();
    t.records.prepareRetro(t.id);
    t.records.proposeRetro(t.id, t.at(), suggestions);
    expect(t.records.chooseRetro(t.id, t.at(), [], 'Pedro').choice).toMatchObject({ selected: [], by: 'Pedro' });
});

test('retention cannot hide or delete an unanswered retro choice', async () => {
    const s = await setup();

    s.merge();

    const retention = { hideAfterDays: 0, deleteAfterDays: 0 };
    const later = new Date(Date.now() + 86400000);

    expect(s.records.hidden(retention, later)).toEqual([]);
    s.records.prepareRetro(s.id);
    s.records.proposeRetro(s.id, s.at(), suggestions);
    expect(s.records.hidden(retention, later)).toEqual([]);
    expect(s.records.deleteExpired(retention, later)).toMatchObject({ deleted: [], kept: [{ workId: s.id }] });
    s.records.chooseRetro(s.id, s.at(), [], 'Pedro');
    expect(s.records.hidden(retention, later).map((r) => r.workId)).toEqual([s.id]);
});
