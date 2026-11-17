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

test('the retro build phase requires both Done and confirmation of the recorded delivery PR merge', async () => {
    const s = await setup();

    for (const status of ['Ready to merge', 'Needs you', 'Done', 'Verify'] as const) {
        s.records.update(s.id, s.at(), { status });
        expect(() => s.records.setBuildPhase(s.id, s.at(), 'retro')).toThrow(/confirmed merge/);
    }
    s.merge();
    expect(s.records.setBuildPhase(s.id, s.at(), 'retro').status).toBe('Done');
});

test('a build proposes its own retro before merge and the board takes the choice before merge', async () => {
    const s = await setup();

    s.records.observe(s.id, s.at(), { of: 'pr', state: 'open' });

    const proposal = s.records.proposeRetro(s.id, s.at(), suggestions);

    expect(proposal).toMatchObject({ pr: 'owner/repo#1', suggestions, choice: null });
    expect(s.records.read(s.id).status).toBe('Ready to merge');
    expect(s.records.proposeRetro(s.id, s.at(), suggestions)).toEqual(proposal);
    expect(() => s.records.chooseRetro(s.id, s.at() - 1, [], 'Pedro')).toThrow(/revision|changed/i);
    for (const invalid of [[-1], [1], [0, 0], ['0']])
        expect(() => s.records.chooseRetro(s.id, s.at(), invalid as number[], 'Pedro')).toThrow(/listed/);
    expect(s.records.retro(s.id)?.choice).toBeNull();
    s.records.chooseRetro(s.id, s.at(), [0], 'Pedro');
    expect(() => s.records.chooseRetro(s.id, s.at(), [], 'Pedro')).toThrow(/awaiting/);
    expect(() => s.records.proposeRetro(s.id, s.at(), [])).toThrow(/already recorded/);

    const captured = s.records.retro(s.id)!;

    captured.captures[0]!.complete = true;
    s.records.saveRetro(s.id, captured);

    const reopened = await openWorkRecords(join(s.dir, 'work.db'));

    try {
        expect(reopened.retro(s.id)).toMatchObject({
            suggestions,
            captures: [{ ...proposal.captures[0], complete: true }],
            choice: { selected: [0], by: 'Pedro' },
        });
    } finally {
        reopened.close();
    }
});

test('propose and choose refuse once the delivery PR is observed merged', async () => {
    const s = await setup();

    s.records.proposeRetro(s.id, s.at(), suggestions);
    s.merge();
    expect(() => s.records.chooseRetro(s.id, s.at(), [0], 'Pedro')).toThrow(/merged/);

    const late = await setup();

    late.merge();
    expect(() => late.records.proposeRetro(late.id, late.at(), suggestions)).toThrow(/merged/);
    expect(late.records.retro(late.id)).toBeNull();

    const moved = await setup();

    moved.records.proposeRetro(moved.id, moved.at(), suggestions);
    moved.records.setPullRequest(moved.id, moved.at(), 'owner/repo#2');
    moved.records.observe(moved.id, moved.at(), { of: 'pr', state: 'merged' });
    expect(moved.records.retro(moved.id)?.pr).toBe('owner/repo#1');
    expect(() => moved.records.chooseRetro(moved.id, moved.at(), [0], 'Pedro')).toThrow(/merged/);
});

test('a stored retro that still carries its thread delivery keeps parsing and takes a proposal', async () => {
    const s = await setup();
    const legacy = {
        pr: 'owner/repo#1',
        suggestions: null,
        choice: null,
        captures: [],
        delivery: { threadId: 'build-thread', commandId: 'command', messageId: 'message', sent: true, error: null },
    };

    s.records.saveRetro(s.id, legacy);
    expect(s.records.retro(s.id)).toEqual(legacy);
    expect(s.records.proposeRetro(s.id, s.at(), suggestions)).toMatchObject({ suggestions });
});
