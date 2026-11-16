import { effectiveVocabulary, type RepositorySetup, type TicketKinds, type TrackerLabels } from '@lar-factory/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { changeAgentKind } from './agent-tracker-writes.ts';
import { agentWrites } from './agent-writes.ts';
import { changeKind } from './change-kind.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const REPO = 'team/app';
const ALLOWED = { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' } as const;
const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function open(): Promise<WorkRecords> {
    const dir = mkdtempSync(join(tmpdir(), 'change-kind-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    return records;
}

const setupOf = (repo: string, access: object = ALLOWED) =>
    ({
        repo,
        access,
        vocabulary: effectiveVocabulary({
            bug: { type: 'Bug', labels: ['type: bug'] },
            feature: { type: 'Feature', labels: ['type: feature'] },
        }).vocabulary,
        itemSource: { kind: 'azure-board', team: 'Web' },
    }) as unknown as RepositorySetup;

/** A tracker holding one ticket, which records each write and fails the one `fail` names. */
function fakeTracker(ticket: { labels: string[]; type: string | null }, { fail }: { fail?: string } = {}) {
    const writes: string[] = [];
    const write = (name: string) => {
        if (name === fail) throw new Error(`refused ${name}`);

        writes.push(name);
    };
    const labels: Pick<TrackerLabels, 'addToTicket' | 'removeFromTicket'> = {
        addToTicket: async (_, names) => {
            for (const name of names) {
                write(`add ${name}`);

                if (!ticket.labels.includes(name)) ticket.labels.push(name);
            }
        },
        removeFromTicket: async (_, names) => {
            for (const name of names) {
                write(`remove ${name}`);
                ticket.labels = ticket.labels.filter((label) => label !== name);
            }
        },
    };
    const kinds: TicketKinds = {
        read: async () => ({ labels: [...ticket.labels], type: ticket.type }),
        setType: async (_, type) => {
            write(`type ${type}`);
            ticket.type = type;
        },
        boardTypes: async () => null,
    };

    return { labels, kinds, writes, ticket };
}

test('a ticket-backed item swaps its labels and type, then the record takes the kind and the agreed ticket kind', async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({
        title: 'T',
        repository: REPO,
        kind: 'bug',
        ticket: `${REPO}#12`,
    }).record;
    const tracker = fakeTracker({ labels: ['type: bug', 'bug', 'docs', 'build'], type: 'Bug' });
    const result = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker });

    expect(result.error).toBeNull();
    expect(tracker.ticket).toEqual({ labels: ['docs', 'build', 'type: feature'], type: 'Feature' });
    expect(result.line).toBe(
        '#12: added label type: feature; removed label type: bug; removed label bug; type Bug to Feature.',
    );
    expect(result.labelChanges).toEqual([
        { label: 'type: feature', action: 'add' },
        { label: 'type: bug', action: 'remove' },
        { label: 'bug', action: 'remove' },
    ]);
    expect(records.read(workId)).toMatchObject({
        kind: 'feature',
        agreedTicketKind: 'feature',
        kindAnswer: null,
        revision: revision + 1,
    });
});

test('a write failing partway keeps the old kind and says what changed, and running the same change again finishes it', async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({
        title: 'T',
        repository: REPO,
        kind: 'bug',
        ticket: `${REPO}#12`,
    }).record;
    const tracker = fakeTracker({ labels: ['bug', 'defect'], type: 'Bug' }, { fail: 'remove defect' });
    const failed = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker });

    expect(failed.error).toBe('Could not finish changing #12 to Feature. refused remove defect');
    expect(failed.line).toBe('#12: added label type: feature; removed label bug.');
    expect(records.read(workId)).toMatchObject({ kind: 'bug', agreedTicketKind: null, revision });

    const retried = await changeKind(records, workId, revision, 'feature', {
        setup: setupOf(REPO),
        ...fakeTracker(tracker.ticket),
    });

    expect(retried.error).toBeNull();
    expect(retried.line).toBe('#12: removed label defect; type Bug to Feature.');
    expect(tracker.ticket).toEqual({ labels: ['type: feature'], type: 'Feature' });
    expect(records.read(workId).kind).toBe('feature');
});

test('without label access for a mapped value only the item changes', async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({
        title: 'T',
        repository: REPO,
        kind: 'bug',
        ticket: `${REPO}#12`,
    }).record;
    const tracker = fakeTracker({ labels: ['bug'], type: 'Bug' });
    const result = await changeKind(records, workId, revision, 'feature', {
        setup: setupOf(REPO, { 'tag-ticket': 'refused', 'type-ticket': 'allowed' }),
        ...tracker,
    });

    expect(tracker.writes).toEqual([]);
    expect(result.error).toBeNull();
    expect(records.read(workId)).toMatchObject({ kind: 'feature', agreedTicketKind: null });
});

test('a stale revision refuses before any tracker call', async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({
        title: 'T',
        repository: REPO,
        kind: 'bug',
        ticket: `${REPO}#12`,
    }).record;

    records.update(workId, revision, { status: 'Queued' });

    const tracker = fakeTracker({ labels: ['bug'], type: 'Bug' });

    await expect(
        changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker }),
    ).rejects.toThrow(/revision/);
    expect(tracker.writes).toEqual([]);
});

test('a record from before the migration has no agreed kind or answer, and keeps its kind', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'change-kind-'));
    const path = join(dir, 'work-records.db');
    // Schema 19 predates agreed ticket kinds; later migrations must not move this fixture.
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 19) });

    old.db
        .prepare(`INSERT INTO work_records (work_id, title, initial_context, repository, kind, status, revision, created_at, updated_at)
    VALUES ('old-work', 'T', '', 'team/app', 'bug', 'List', 1, '2026-01-01', '2026-01-01')`)
        .run();
    old.close();

    const records = await openWorkRecords(path);

    opened.push({ records, dir });
    expect(records.read('old-work')).toMatchObject({ kind: 'bug', agreedTicketKind: null, kindAnswer: null });
});

test.each([false, true])(
    'agent kind changes protect intent across provider waits; conflict=%s',
    async (conflicting) => {
        const records = await open();
        const record = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
        const tracker = fakeTracker({ labels: ['type: bug'], type: 'Bug' });
        const read = tracker.kinds.read.bind(tracker.kinds);

        tracker.kinds.read = async (...args) => {
            if (conflicting) records.update(record.workId, record.revision, { kind: 'improvement' });
            else records.setNeedsYou(record.workId, record.revision, 'Concurrent note');

            return read(...args);
        };

        const result = await changeAgentKind(agentWrites(records), record.workId, record.revision, 'feature', {
            setup: setupOf(REPO),
            ...tracker,
        });

        if (conflicting) {
            expect(result.error).toContain('conflicting fields: kind');
            expect(records.read(record.workId).kind).toBe('improvement');
        } else {
            expect(result.error).toBeNull();
            expect(records.read(record.workId)).toMatchObject({ kind: 'feature', needsYou: 'Concurrent note' });
        }
    },
);
