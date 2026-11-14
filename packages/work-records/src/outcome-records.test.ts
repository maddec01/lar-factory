import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: WorkRecords[] = [];
const dirs: string[] = [];

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setup(owner = true) {
    const dir = mkdtempSync(join(tmpdir(), 'outcome-run-'));

    dirs.push(dir);

    const path = join(dir, 'work.db');
    const records = await openWorkRecords(path);

    opened.push(records);

    const group = records.create({
        title: 'Group',
        repository: 'sample/repo',
        kind: 'feature',
        status: 'In progress',
    }).workId;
    const at = (id = group) => records.read(id).revision;

    if (owner) records.addThread(group, at(), 'group-owner', 'shape');

    const part = records.createPart({
        parentId: group,
        parentRevision: at(),
        title: 'Part',
        repository: 'sample/repo',
        kind: 'build',
        body: 'Blocked by: none',
        blockerIds: [],
    }).workId;

    records.setPullRequest(part, at(part), 'sample/repo#1');
    records.setReleasePlan(group, at(), {
        steps: [{ id: 'activate', who: 'Pedro', what: 'Activate' }],
        outcomeCheck: 'Check merged composition.',
    });

    const merge = () => records.observe(part, at(part), { of: 'pr', state: 'merged' });
    const release = () => records.completeReleaseStep(group, at(), 'activate', 'Pedro', 'Activated receipt.');

    return { records, group, part, at, path, merge, release };
}

test('waits for delivery and ordered release, then preserves dispatch IDs across a database reopen', async () => {
    const f = await setup();

    expect(f.records.prepareOutcomeCheck(f.group).run).toBeNull();
    f.merge();
    expect(f.records.prepareOutcomeCheck(f.group).run).toBeNull();
    f.release();

    const first = f.records.prepareOutcomeCheck(f.group).run!;

    expect(first.threadId).toBe('group-owner');
    f.records.outcomeCheckDelivered(f.group, first.commandId, 'unconfirmed', 'Lost response');

    const reopened = await openWorkRecords(f.path);

    opened.push(reopened);
    expect(reopened.prepareOutcomeCheck(f.group).run).toMatchObject({
        commandId: first.commandId,
        messageId: first.messageId,
        sent: false,
    });
    reopened.outcomeCheckDelivered(f.group, first.commandId, 'accepted');
    expect(reopened.prepareOutcomeCheck(f.group).run?.sent).toBe(true);
    expect(() => reopened.recordOutcomeCheck(f.group, f.at(), 'passed', 'Owner', 'Passed')).toThrow(/input-digest/);
    reopened.recordOutcomeCheck(f.group, f.at(), 'passed', 'Owner', 'Merged exact SHAs passed.', first.digest);
    expect(reopened.completion(f.group).complete).toBe(true);
    expect(reopened.outcomeCheck(f.group).ready).toBe(false);
});

test('rejects a dispatched result after the release criterion changes and prepares a new identity', async () => {
    const f = await setup();

    f.merge();
    f.release();

    const first = f.records.prepareOutcomeCheck(f.group).run!;

    f.records.setReleasePlan(f.group, f.at(), { steps: [], outcomeCheck: 'Check changed criterion.' });
    expect(() =>
        f.records.recordOutcomeCheck(f.group, f.at(), 'passed', 'Owner', 'Old evidence', first.digest),
    ).toThrow(/composition changed/);

    const next = f.records.prepareOutcomeCheck(f.group).run!;

    expect(next.digest).not.toBe(first.digest);
    expect(next.commandId).not.toBe(first.commandId);
    f.records.outcomeCheckDelivered(f.group, first.commandId, 'accepted');
    expect(f.records.outcomeCheck(f.group).run?.sent).toBe(false);
});

test('a missing group owner returns an actionable check rather than manufacturing an owner', async () => {
    const f = await setup(false);

    f.merge();
    f.release();
    expect(f.records.prepareOutcomeCheck(f.group)).toMatchObject({ ready: true, run: null });
});

test('failed Outcome repair is explicit, digest-bound and durable; new parts still need the normal gate', async () => {
    const f = await setup();

    f.merge();
    f.release();

    const original = f.records.prepareOutcomeCheck(f.group).run!;

    f.records.outcomeCheckDelivered(f.group, original.commandId, 'accepted');
    f.records.recordOutcomeCheck(
        f.group,
        f.at(),
        'failed',
        'Outcome owner',
        'C cannot consume B output.',
        original.digest,
    );
    expect(f.records.prepareOutcomeCheck(f.group).run).toMatchObject({ commandId: original.commandId });
    expect(() => f.records.prepareOutcomeFix(f.group, f.at() - 1, original.digest)).toThrow('revision');
    expect(() => f.records.prepareOutcomeFix(f.group, f.at(), 'stale')).toThrow('current failed Outcome');

    const fix = f.records.prepareOutcomeFix(f.group, f.at(), original.digest);

    expect(fix.threadId).toBe('group-owner');
    expect(fix.commandId).not.toBe(original.commandId);

    const reopened = await openWorkRecords(f.path);

    opened.push(reopened);
    expect(reopened.prepareOutcomeFix(f.group, f.at(), original.digest)).toEqual(fix);
    reopened.outcomeFixDelivered(f.group, fix.commandId, 'accepted');
    expect(reopened.outcomeCheck(f.group).run?.fixProposal?.sent).toBe(true);
    expect(reopened.releasePlan(f.group)?.outcomeCheck.result).toBe('failed');

    const parts = reopened.createParts(f.group, f.at(), {
        map: '## Destination\nRepair B→C dataflow.',
        parts: [
            {
                key: 'fix',
                title: 'Feed B accepted text into C',
                repository: 'sample/repo',
                kind: 'build',
                body: 'Blocked by: none',
                blockerIds: [],
            },
        ],
    });

    expect(parts).toBeTruthy();

    const part = reopened.children(f.group).find((p) => p.title === 'Feed B accepted text into C')!;

    expect(reopened.gate(part.workId).current).toBe(false);
    expect(reopened.outcomeCheck(f.group).ready).toBe(false);
    expect(reopened.completion(f.group).complete).toBe(false);
});
