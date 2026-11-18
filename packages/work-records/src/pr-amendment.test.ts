import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { gateManifest } from './gate-batch.ts';
import { approvePrAmendment, beginPrAmendment } from './pr-amendment.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture(amend = true) {
    const dir = mkdtempSync(join(tmpdir(), 'pr-amendment-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ records, dir });

    const id = records.create({ title: 'Greeting', repository: 'example/repo', kind: 'bug', status: 'Review' }).workId;
    const revision = () => records.read(id).revision;

    records.setPullRequest(id, revision(), 'example/repo#1');
    records.setBody(id, revision(), 'brief', completeBrief('## What\nClick to greet.\n## Verify\nno'));
    records.recordGate(id, revision(), {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'Human',
        evidence: 'Original approval',
    });

    if (amend)
        records.setBody(id, revision(), 'brief', completeBrief('## What\nAccept Enter to greet.\n## Verify\nno'));

    const input = records.doubtPackage(id);

    records.recordDoubt(id, input.packageDigest, 'Doubt', 'Scope and code checked.');

    const display = records.displayGate(id);
    const url = 'https://github.com/example/repo/pull/1#issuecomment-23';
    const read = async (path: string) =>
        path.includes('collaborators')
            ? { permission: 'write' }
            : path.includes('comments')
              ? { html_url: url, user: { login: 'User', type: 'User' }, body: 'Please support Enter too.' }
              : { html_url: 'https://github.com/example/repo/pull/1', state: 'open', merged: false };

    return { records, id, display, url, read };
}

test('bots, read-only people, other PRs and stale displays cannot approve amendments', async () => {
    const f = await fixture();

    for (const change of [{ user: { login: 'bot', type: 'Bot' } }, { permission: 'read' }]) {
        const read = async (path: string) => ({ ...(await f.read(path)), ...change });

        await expect(
            approvePrAmendment(f.records, f.id, f.display, f.display.approvalDigest, f.url, read),
        ).rejects.toThrow(/human|write access/);
    }
    await expect(
        approvePrAmendment(
            f.records,
            f.id,
            f.display,
            f.display.approvalDigest,
            f.url.replace('/pull/1', '/pull/2'),
            f.read,
        ),
    ).rejects.toThrow('recorded GitHub PR');
    await expect(approvePrAmendment(f.records, f.id, f.display, 'stale', f.url, f.read)).rejects.toThrow(
        /digest|changed|approval/i,
    );
    expect(f.records.gate(f.id).current).toBe(false);
});

test('an agent reply using the human login cannot approve a Spec amendment', async () => {
    const f = await fixture();

    f.records.recordPrAgentComment(f.id, f.url);
    await expect(
        approvePrAmendment(f.records, f.id, f.display, f.display.approvalDigest, f.url, f.read),
    ).rejects.toThrow('agent reply');
    expect(f.records.gate(f.id).current).toBe(false);
});

test('authorization precedes the correction, survives lifecycle progress, and retires only with its exact gate', async () => {
    const f = await fixture(false);

    await beginPrAmendment(f.records, f.id, f.url, f.read);
    expect(f.records.prLoop(f.id).amendment).toMatchObject({ source: f.url, by: 'User' });
    f.records.setBody(f.id, f.records.read(f.id).revision, 'brief', completeBrief('Accept Enter too.'));

    const input = f.records.doubtPackage(f.id);

    f.records.recordDoubt(f.id, input.packageDigest, 'Doubt', 'No conflict.');

    const display = f.records.displayGate(f.id);

    f.records.setBuildPhase(f.id, f.records.read(f.id).revision, 'checks');
    await expect(approvePrAmendment(f.records, f.id, display, 'stale', f.url, f.read)).rejects.toThrow(
        /digest changed/,
    );
    expect(f.records.prLoop(f.id).amendment).toBeDefined();
    await approvePrAmendment(f.records, f.id, display, display.approvalDigest, f.url, f.read);
    expect(f.records.gate(f.id).current).toBe(true);
    expect(f.records.prLoop(f.id).amendment).toBeUndefined();
});

test('one producer comment amends a linked consumer without a PR and binds the parent and Outcome atomically', async () => {
    const f = await fixture(false);
    const parent = f.records.create({ title: 'Greetings', repository: 'example/repo', kind: 'concept' }).workId;
    const consumer = f.records.create({
        title: 'Display',
        repository: 'example/display',
        kind: 'build',
        status: 'Ready',
    }).workId;
    const rev = (id: string) => f.records.read(id).revision;

    f.records.update(f.id, rev(f.id), { kind: 'build' });
    f.records.setParent(f.id, rev(f.id), parent);
    f.records.setParent(consumer, rev(consumer), parent);
    f.records.setBody(consumer, rev(consumer), 'brief', completeBrief('Click to greet.'));
    f.records.recordGate(consumer, rev(consumer), {
        briefDigest: f.records.gate(consumer).briefDigest!,
        approvedBy: 'User',
        evidence: 'Original approval',
    });
    await beginPrAmendment(f.records, f.id, f.url, f.read, [consumer]);
    expect(f.records.activePrAmendment(consumer)?.ownerId).toBe(f.id);
    expect(f.records.activePrAmendment(parent)?.ownerId).toBe(f.id);
    expect(() => f.records.buildReadiness(consumer, { limit: 2 })).toThrow('amendment is still being corrected');

    const entry = opened.find((entry) => entry.records === f.records)!;

    f.records.close();
    f.records = await openWorkRecords(join(entry.dir, 'work.db'));
    entry.records = f.records;
    expect(f.records.activePrAmendment(consumer)?.ownerId).toBe(f.id);

    for (const id of [f.id, consumer]) f.records.setBody(id, rev(id), 'brief', completeBrief('Accept Enter to greet.'));
    f.records.setBody(parent, rev(parent), 'map', '## Destination\nAccept Enter to greet.');
    f.records.setReleasePlan(parent, rev(parent), { steps: [], outcomeCheck: 'Enter greets on the page.' });

    const doubt = () => {
        for (const id of [f.id, consumer])
            f.records.recordDoubt(
                id,
                f.records.doubtPackage(id).packageDigest,
                'Doubt',
                'Consistent linked behaviour.',
            );
    };

    doubt();

    const display = f.records.displayPrAmendment(f.id);

    // A changed map or Outcome cannot be silently authorized by an earlier display, even if Doubt stays current.
    f.records.setBody(parent, rev(parent), 'map', '## Destination\nEscape greets.');
    await expect(approvePrAmendment(f.records, f.id, display, display.digest, f.url, f.read)).rejects.toThrow(
        'content',
    );
    f.records.setBody(parent, rev(parent), 'map', '## Destination\nAccept Enter to greet.');
    f.records.setReleasePlan(parent, rev(parent), { steps: [], outcomeCheck: 'Escape greets.' });
    await expect(approvePrAmendment(f.records, f.id, display, display.digest, f.url, f.read)).rejects.toThrow(
        'content',
    );
    f.records.setReleasePlan(parent, rev(parent), { steps: [], outcomeCheck: 'Enter greets on the page.' });

    f.records.setBody(consumer, rev(consumer), 'brief', completeBrief('Accept Escape to greet.'));
    doubt();
    await expect(approvePrAmendment(f.records, f.id, display, display.digest, f.url, f.read)).rejects.toThrow(
        /content|changed/,
    );
    expect([f.id, consumer].map((id) => f.records.gate(id).current)).toEqual([false, false]);
    expect(f.records.activePrAmendment(consumer)).not.toBeNull();

    f.records.setBody(consumer, rev(consumer), 'brief', completeBrief('Accept Enter to greet.'));
    doubt();

    const corrected = f.records.displayPrAmendment(f.id);
    const changedComment = async (path: string) => ({
        ...(await f.read(path)),
        ...(path.includes('comments') ? { body: 'Use Escape instead.' } : {}),
    });

    await expect(
        approvePrAmendment(f.records, f.id, corrected, corrected.digest, f.url, changedComment),
    ).rejects.toThrow('comment changed');
    await expect(
        approvePrAmendment(
            f.records,
            f.id,
            corrected.gates.members[0]!.display,
            corrected.gates.members[0]!.display.approvalDigest,
            f.url,
            f.read,
        ),
    ).rejects.toThrow('complete linked amendment');

    const { digest: _digest, ...partial } = corrected;

    partial.gates = gateManifest(corrected.gates.members.slice(0, 1));

    const partialDigest = createHash('sha256').update(JSON.stringify(partial)).digest('hex');

    await expect(
        approvePrAmendment(f.records, f.id, { ...partial, digest: partialDigest }, partialDigest, f.url, f.read),
    ).rejects.toThrow('every affected delivery gate');
    expect([f.id, consumer].map((id) => f.records.gate(id).current)).toEqual([false, false]);
    f.records.setBuildPhase(f.id, rev(f.id), 'checks');
    await approvePrAmendment(f.records, f.id, corrected, corrected.digest, f.url, f.read);
    expect([f.id, consumer].map((id) => f.records.gate(id).current)).toEqual([true, true]);
    expect(f.records.read(consumer).pullRequest).toBeNull();
    expect(f.records.read(consumer).status).toBe('Ready');
    for (const id of [f.id, consumer]) {
        const receipt = f.records.gate(id).passing!;

        expect(receipt.evidence).toContain(f.url);
        expect(receipt.evidence).toContain(corrected.digest);
        expect(receipt.evidence).toContain('Enter greets on the page.');
        expect(receipt.batchDigest).toBe(corrected.gates.digest);
        expect(f.records.activePrAmendment(id)).toBeNull();
    }
});

test('a producer cannot use its comment to amend unrelated work or grant an initial consumer approval', async () => {
    const f = await fixture(false);
    const unrelated = f.records.create({ title: 'Unrelated', repository: 'example/repo', kind: 'build' }).workId;

    await expect(beginPrAmendment(f.records, f.id, f.url, f.read, [unrelated])).rejects.toThrow('linked builds');

    const parent = f.records.create({ title: 'Group', repository: 'example/repo', kind: 'concept' }).workId;

    f.records.update(f.id, f.records.read(f.id).revision, { kind: 'build' });
    f.records.setParent(f.id, f.records.read(f.id).revision, parent);
    f.records.setParent(unrelated, f.records.read(unrelated).revision, parent);
    await expect(beginPrAmendment(f.records, f.id, f.url, f.read, [unrelated])).rejects.toThrow('originally approved');
    expect(f.records.activePrAmendment(f.id)).toBeNull();
});
