import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkKind, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const open = async (path = join(tempDir(), 'work-records.db')) => {
    const records = await openWorkRecords(path);

    opened.push(records);

    return records;
};
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-records-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('work records', () => {
    it('keeps records and their tickets across close and reopen', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const made = first.create({
            title: 'Work',
            repository: 'maddec01/lar',
            kind: 'bug',
            ticket: 'maddec01/lar#12',
        });

        first.close();

        const reopened = await open(path);

        expect(reopened.read(made.workId)).toEqual(made);
    });

    it('keeps the title and initial context it was captured with, which a repeated import never overwrites', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const captured = first.create({
            title: 'Add dark mode',
            context: 'The board is too bright.\n',
            repository: 'maddec01/lar',
            kind: 'feature',
        });
        const imported = first.importTicket({
            title: 'Fix login',
            context: '## Steps\n\nSign in.\n',
            repository: 'maddec01/lar',
            kind: 'bug',
            ticket: 'maddec01/lar#41',
        });

        first.close();

        const reopened = await open(path);

        expect(reopened.read(captured.workId)).toMatchObject({ title: 'Add dark mode' });
        expect(reopened.initialContext(captured.workId)).toBe('The board is too bright.\n');

        const edited = reopened.importTicket({
            title: 'Fix login (edited)',
            context: 'Edited.',
            repository: 'maddec01/lar',
            kind: 'bug',
            ticket: 'maddec01/lar#41',
        });

        expect(edited).toEqual({ record: imported.record, created: false });
        expect(reopened.initialContext(imported.record.workId)).toBe('## Steps\n\nSign in.\n');
        expect(
            reopened.initialContext(
                reopened.create({ title: 'No context', repository: 'maddec01/lar', kind: 'bug' }).workId,
            ),
        ).toBe('');
        expect(() => reopened.create({ title: ' ', repository: 'maddec01/lar', kind: 'bug' })).toThrow(/title/);
        expect(() => reopened.create({ title: 'Two\nlines', repository: 'maddec01/lar', kind: 'bug' })).toThrow(
            /title/,
        );
    });

    it('brings an earlier database up to date, keeping its records with an empty title', async () => {
        const path = join(tempDir(), 'work-records.db');
        const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 4) });

        old.db
            .prepare(`INSERT INTO work_records (work_id, repository, kind, status, revision, created_at, updated_at)
      VALUES ('w-1', 'maddec01/lar', 'build', 'List', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`)
            .run();
        old.close();

        const records = await open(path);

        expect(records.read('w-1')).toMatchObject({ title: '', revision: 1 });
        expect(records.initialContext('w-1')).toBe('');
        expect(readdirSync(dirname(path)).filter((file) => file.includes('.before-'))).toEqual([]);
    });

    it('refuses a ticket another record already holds', async () => {
        const records = await open();

        records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#3' });

        const other = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug' });

        expect(() => records.attachTicket(other.workId, 1, 'maddec01/lar#3')).toThrow(
            expect.objectContaining({ code: 'ticket-taken' }),
        );
        expect(records.read(other.workId)).toEqual(other);
    });

    it('updates with the current revision and refuses a stale one without overwriting', async () => {
        const path = join(tempDir(), 'work-records.db');
        const board = await open(path);
        const thread = await open(path);
        const made = board.create({ title: 'Work', repository: 'maddec01/lar', kind: 'feature' });

        const shaped = board.update(made.workId, made.revision, { status: 'Shaping' });

        expect(shaped).toMatchObject({ status: 'Shaping', revision: 2 });
        expect(() => thread.update(made.workId, made.revision, { status: 'Ready' })).toThrow(
            expect.objectContaining({ code: 'stale-revision', message: expect.stringContaining('revision 2') }),
        );
        expect(thread.read(made.workId)).toEqual(shaped);
    });

    it(
        'keeps every commit from two processes writing at once, refusing only stale or locked writes',
        { timeout: 30_000 },
        async () => {
            const path = join(tempDir(), 'work-records.db');
            const made = (await open(path)).create({ title: 'Work', repository: 'maddec01/lar', kind: 'build' });
            // Each writer appends a line named after itself to the brief it just read, naming the revision it read. Neither
            // starts writing until both have marked themselves ready.
            const writer = `import { existsSync, writeFileSync } from 'node:fs';
      import { openWorkRecords } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'work-records.ts')).href)};
      const [path, workId, name, other] = process.argv.slice(1);
      const records = await openWorkRecords(path);
      writeFileSync(path + '.' + name + '-ready', '');
      while (!existsSync(path + '.' + other + '-ready'));
      const outcomes = [];
      for (let i = 0; i < 100; i++) {
        const { revision } = records.read(workId);
        const brief = records.body(workId, 'brief') ?? '';
        try {
          records.setBody(workId, revision, 'brief', brief + name + '-' + i + '\\n');
          outcomes.push(name + '-' + i);
        } catch (error) {
          outcomes.push(error.code ?? String(error));
        }
      }
      records.close();
      process.stdout.write(JSON.stringify(outcomes));`;
            const run = (name: string, other: string) =>
                promisify(execFile)(process.execPath, [
                    '--disable-warning=ExperimentalWarning',
                    '--input-type=module',
                    '-e',
                    writer,
                    path,
                    made.workId,
                    name,
                    other,
                ]);
            const outcomes = (await Promise.all([run('board', 'thread'), run('thread', 'board')])).flatMap(
                ({ stdout }) => JSON.parse(stdout) as string[],
            );

            const committed = outcomes.filter((outcome) => /^(board|thread)-\d+$/.test(outcome));

            for (const name of ['board', 'thread'])
                expect(committed.some((outcome) => outcome.startsWith(`${name}-`))).toBe(true);
            for (const refused of outcomes.filter((outcome) => !committed.includes(outcome)))
                expect(['stale-revision', 'busy']).toContain(refused);

            const reader = await open(path);

            expect(reader.body(made.workId, 'brief')!.split('\n').filter(Boolean).toSorted()).toEqual(
                committed.toSorted(),
            );
            expect(reader.read(made.workId).revision).toBe(1 + committed.length);
        },
    );
});

describe('work-record structure', () => {
    const lar = (records: WorkRecords, kind: WorkKind) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind });

    it('puts decisions and builds under a concept and slices under a build', async () => {
        const records = await open();
        const concept = lar(records, 'concept');
        const decision = lar(records, 'decision');
        const build = lar(records, 'build');
        const slice = lar(records, 'slice');

        expect(records.setParent(decision.workId, 1, concept.workId)).toMatchObject({
            parentId: concept.workId,
            revision: 2,
        });
        records.setParent(build.workId, 1, concept.workId);
        records.setParent(slice.workId, 1, build.workId);
        expect(records.read(concept.workId).revision).toBe(3);
        expect(records.children(concept.workId).map((r) => r.workId)).toEqual([decision.workId, build.workId]);
        expect(records.children(build.workId).map((r) => r.workId)).toEqual([slice.workId]);
    });

    it('records blockers and lists them from both ends', async () => {
        const records = await open();
        const [a, b, c] = [lar(records, 'feature'), lar(records, 'bug'), lar(records, 'build')];

        expect(records.addBlocker(a.workId, 1, b.workId).revision).toBe(2);
        records.addBlocker(a.workId, 2, c.workId);
        expect(records.read(b.workId).revision).toBe(2);
        expect(records.blockers(a.workId).map((r) => r.workId)).toEqual([b.workId, c.workId]);
        expect(records.dependents(b.workId).map((r) => r.workId)).toEqual([a.workId]);

        expect(records.removeBlocker(a.workId, 3, b.workId).revision).toBe(4);
        expect(records.blockers(a.workId).map((r) => r.workId)).toEqual([c.workId]);
        expect(() => records.removeBlocker(a.workId, 4, b.workId)).toThrow(
            expect.objectContaining({ code: 'invalid' }),
        );
        expect(() => records.addBlocker(a.workId, 4, c.workId)).toThrow(expect.objectContaining({ code: 'invalid' }));
    });

    it('refuses a self-blocker and an edge that closes a cycle', async () => {
        const records = await open();
        const [a, b, c] = [lar(records, 'feature'), lar(records, 'bug'), lar(records, 'build')];

        expect(() => records.addBlocker(a.workId, 1, a.workId)).toThrow(
            expect.objectContaining({ code: 'invalid', message: expect.stringContaining("can't block itself") }),
        );
        records.addBlocker(a.workId, 1, b.workId);
        records.addBlocker(b.workId, 2, c.workId);

        const before = records.list({});

        expect(() => records.addBlocker(c.workId, 2, a.workId)).toThrow(
            expect.objectContaining({ code: 'invalid', message: expect.stringContaining('cycle') }),
        );
        expect(records.list({})).toEqual(before);
        expect(records.blockers(c.workId)).toEqual([]);
    });
});

describe('work-record content', () => {
    const lar = (records: WorkRecords, kind: WorkKind) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind });

    it('keeps a build brief, a decision text and a concept map across close and reopen', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const [build, decision, concept] = [lar(first, 'build'), lar(first, 'decision'), lar(first, 'concept')];

        expect(first.setBody(build.workId, 1, 'brief', '## What\n\nAdd it.\n')).toMatchObject({ revision: 2 });
        first.setBody(build.workId, 2, 'brief', '## What\n\nAdd it now.\n');
        first.setBody(decision.workId, 1, 'decision', 'Use SQLite.');
        first.setBody(concept.workId, 1, 'map', '# Map');
        first.close();

        const reopened = await open(path);

        expect(reopened.body(build.workId, 'brief')).toBe('## What\n\nAdd it now.\n');
        expect(reopened.body(decision.workId, 'decision')).toBe('Use SQLite.');
        expect(reopened.body(concept.workId, 'map')).toBe('# Map');
        expect(reopened.body(concept.workId, 'brief')).toBeNull();
    });

    it('holds one current delivery PR and keeps each replaced one as history', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = lar(first, 'build');

        first.setPullRequest(build.workId, 1, 'maddec01/lar#88');
        expect(first.setPullRequest(build.workId, 2, 'maddec01/lar#88')).toMatchObject({ revision: 2 });
        first.setPullRequest(build.workId, 2, 'maddec01/lar#95');
        first.close();

        const reopened = await open(path);

        expect(reopened.read(build.workId)).toMatchObject({ pullRequest: 'maddec01/lar#95', revision: 3 });
        expect(reopened.replacedPullRequests(build.workId)).toEqual([
            { pullRequest: 'maddec01/lar#88', replacedAt: expect.any(String) },
        ]);
        expect(() => reopened.setPullRequest(build.workId, 2, 'maddec01/lar#96')).toThrow(
            expect.objectContaining({ code: 'stale-revision' }),
        );
        expect(reopened.replacedPullRequests(build.workId)).toHaveLength(1);
    });

    const round1 = {
        base: 'c8890a1a',
        reviewers: [
            {
                axis: 'code',
                verdict: 'changes',
                findings: [
                    { severity: 'should', summary: 'Spec: src/cli.ts:12: the help skips export.', disposition: 'open' },
                    {
                        severity: 'nit',
                        summary: 'Standards: src/cli.ts:40: name it run.',
                        disposition: 'rejected',
                        reason: 'The repo names it so.',
                    },
                ],
            },
            { axis: 'security', verdict: 'approve', findings: [], notChecked: 'Signed releases.' },
            { axis: 'ui', verdict: 'skipped', findings: [], notChecked: 'Nothing on screen changed.' },
        ],
    } as const;

    it('keeps a review round with every axis, finding and disposition across close and reopen', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = lar(first, 'build');

        expect(first.recordReviewRound(build.workId, 1, round1)).toMatchObject({ revision: 2 });
        first.setFindingDisposition(build.workId, 2, { round: 1, axis: 'code', finding: 1 }, 'fixed');
        first.recordReviewRound(build.workId, 3, {
            base: 'aa11bb22',
            reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }],
        });
        first.close();

        const rounds = (await open(path)).reviewRounds(build.workId);

        expect(rounds.map((r) => [r.round, r.base])).toEqual([
            [1, 'c8890a1a'],
            [2, 'aa11bb22'],
        ]);
        expect(rounds[0]!.reviewers).toEqual([
            {
                axis: 'code',
                verdict: 'changes',
                notChecked: null,
                findings: [
                    {
                        severity: 'should',
                        summary: 'Spec: src/cli.ts:12: the help skips export.',
                        disposition: 'fixed',
                        reason: null,
                    },
                    {
                        severity: 'nit',
                        summary: 'Standards: src/cli.ts:40: name it run.',
                        disposition: 'rejected',
                        reason: 'The repo names it so.',
                    },
                ],
            },
            { axis: 'security', verdict: 'approve', notChecked: 'Signed releases.', findings: [] },
            { axis: 'ui', verdict: 'skipped', notChecked: 'Nothing on screen changed.', findings: [] },
        ]);
    });

    it('leaves no round behind when one of its findings fails validation', async () => {
        const records = await open();
        const build = lar(records, 'build');
        const broken = {
            ...round1,
            reviewers: [
                round1.reviewers[0],
                {
                    axis: 'performance',
                    verdict: 'changes',
                    findings: [{ severity: 'huge', summary: 'Slow.', disposition: 'open' }],
                },
            ],
        };

        expect(() => records.recordReviewRound(build.workId, 1, broken as never)).toThrow(
            expect.objectContaining({ code: 'invalid', message: expect.stringContaining('severity "huge"') }),
        );
        expect(records.reviewRounds(build.workId)).toEqual([]);
        expect(records.read(build.workId)).toEqual(build);
    });
});

describe('work-record threads and launch intents', () => {
    it('keeps failed shaping starts queued and preserves a status the agent already advanced', async () => {
        const records = await open();
        let work = records.create({ title: 'Shape me', repository: 'maddec01/lar', kind: 'feature', status: 'Queued' });
        let launching = records.recordLaunchIntent(work.workId, work.revision, 'shape');

        work = records.resolveLaunchIntent(work.workId, launching.record.revision, launching.intent.intentId, {
            failure: 'Unavailable',
        }).record;
        expect(work.status).toBe('Queued');
        launching = records.recordLaunchIntent(work.workId, work.revision, 'shape');
        work = records.update(work.workId, launching.record.revision, { status: 'Ready' });
        expect(
            records.resolveLaunchIntent(work.workId, work.revision, launching.intent.intentId, {
                threadId: 'already-ready',
            }).record.status,
        ).toBe('Ready');
    });

    const lar = (records: WorkRecords, kind: WorkKind) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind });

    it('finds an unresolved launch intent after reopening and resolves it to a thread ID exactly once', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = lar(first, 'build');
        let { record, intent } = first.recordLaunchIntent(build.workId, 1, 'build');

        expect(record.revision).toBe(2);
        expect(intent).toMatchObject({
            workId: build.workId,
            purpose: 'build',
            outcome: null,
            threadId: null,
            resolvedAt: null,
        });

        const request = {
            projectId: 'project',
            text: 'Build',
            selection: { instanceId: 'codex', model: 'gpt-6.1-sol' },
            workspace: { type: 'root' as const },
            runtimeMode: 'full-access',
        };

        record = first.saveLaunchRequest(build.workId, record.revision, intent.intentId, request);
        intent = first.launchIntents({ workId: build.workId })[0]!;
        expect(intent.request).toEqual(request);
        expect(() =>
            first.saveLaunchRequest(build.workId, record.revision, intent.intentId, { ...request, text: 'Different' }),
        ).toThrow(/frozen/);
        first.close();

        const board = await open(path);
        const thread = await open(path);

        expect(board.launchIntents({ unresolved: true })).toEqual([intent]);

        const resolved = board.resolveLaunchIntent(build.workId, 3, intent.intentId, { threadId: 'thread-9' });

        expect(resolved.intent).toMatchObject({ outcome: 'started', threadId: 'thread-9' });
        expect(resolved.record.revision).toBe(4);
        expect(board.threads(build.workId).map((t) => [t.threadId, t.purpose])).toEqual([['thread-9', 'build']]);

        expect(() => thread.resolveLaunchIntent(build.workId, 4, intent.intentId, { threadId: 'thread-10' })).toThrow(
            expect.objectContaining({ code: 'invalid', message: expect.stringContaining('already resolved') }),
        );
        expect(thread.launchIntents({ unresolved: true })).toEqual([]);
        expect(thread.launchIntents({ workId: build.workId })).toEqual([resolved.intent]);
        expect(thread.threads(build.workId)).toHaveLength(1);
    });
});

describe('work-record facts the board sets', () => {
    const lar = (records: WorkRecords, kind: WorkKind) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind });

    it('waits and resumes atomically, preserves causes and rejects stale or invalid writes', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = first.create({ title: 'Work', repository: 'maddec01/lar', kind: 'build', status: 'Queued' });

        first.setNeedsYouCauses(build.workId, 1, [{ type: 'pr-closed' }]);
        expect(() => first.waitForUser(build.workId, 2, ' ')).toThrow(/reason/);
        expect(() => first.waitForUser(build.workId, 1, 'Should search match whole words?')).toThrow(/revision/i);
        expect(first.read(build.workId)).toMatchObject({ status: 'Queued', needsYou: null, revision: 2 });
        expect(first.waitForUser(build.workId, 2, 'Should search match whole words?')).toMatchObject({
            status: 'Needs you',
            needsYou: 'Should search match whole words?',
            queueOrder: null,
            revision: 3,
        });
        expect(first.waitForUser(build.workId, 3, 'Should search match whole words?').revision).toBe(3);
        first.close();

        const reopened = await open(path);

        expect(reopened.read(build.workId)).toMatchObject({
            status: 'Needs you',
            needsYou: 'Should search match whole words?',
        });
        for (const status of ['Needs you', 'Done', 'Nowhere'])
            expect(() => reopened.resumeFromUser(build.workId, 3, status as never)).toThrow(/Status/);
        expect(() => reopened.resumeFromUser(build.workId, 2, 'Shaping')).toThrow(/revision/i);
        expect(reopened.read(build.workId)).toMatchObject({
            status: 'Needs you',
            needsYou: 'Should search match whole words?',
            revision: 3,
        });
        expect(reopened.resumeFromUser(build.workId, 3, 'Queued')).toMatchObject({
            status: 'Queued',
            needsYou: null,
            needsYouCauses: [{ type: 'pr-closed' }],
            queueOrder: expect.any(Number),
            revision: 4,
        });
        expect(reopened.resumeFromUser(build.workId, 4, 'Queued').revision).toBe(4);
        expect(reopened.waitForUser(build.workId, 4, 'Should search match whole words?').revision).toBe(5);
        expect(reopened.resumeFromUser(build.workId, 5, 'Review')).toMatchObject({
            status: 'Review',
            needsYou: null,
            revision: 6,
        });
    });

    it('keeps Needs you causes apart from the free text, across a reopen', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = lar(first, 'build');

        expect(build.needsYouCauses).toEqual([]);

        const moved = { type: 'assignee-changed', from: 'pedro', to: null } as const;

        first.setNeedsYou(build.workId, 1, 'The implementer could not finish it.');
        first.setNeedsYouCauses(build.workId, 2, [{ type: 'pr-closed' }, moved]);
        first.close();

        const reopened = await open(path);

        expect(reopened.read(build.workId)).toMatchObject({
            needsYou: 'The implementer could not finish it.',
            needsYouCauses: [{ type: 'pr-closed' }, moved],
            revision: 3,
        });
        expect(
            reopened.setNeedsYouCauses(build.workId, 3, [{ type: 'pr-closed' }, moved]).revision,
            'the same causes write nothing',
        ).toBe(3);
        expect(reopened.clearNeedsYou(build.workId, 3)).toMatchObject({
            needsYou: null,
            needsYouCauses: [{ type: 'pr-closed' }, moved],
            revision: 4,
        });
        expect(reopened.setNeedsYou(build.workId, 4, 'Merge conflict').revision).toBe(5);
        expect(reopened.setNeedsYouCauses(build.workId, 5, [], { clearReason: true })).toMatchObject({
            needsYou: null,
            needsYouCauses: [],
            revision: 6,
        });
    });

    it("snapshots a build's selected project skills once, so later selections leave it alone", async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = lar(first, 'build');

        expect(build.skills).toBeNull();
        first.snapshotSkills(build.workId, 1, ['react-patterns', 'acme:testing']);
        first.close();

        const reopened = await open(path);

        expect(reopened.read(build.workId)).toMatchObject({ skills: ['react-patterns', 'acme:testing'], revision: 2 });
        expect(() => reopened.snapshotSkills(build.workId, 2, ['other'])).toThrow(/already snapshotted/);
        expect(reopened.snapshotSkills(lar(reopened, 'feature').workId, 1, [])).toMatchObject({ skills: [] });
        expect(() => reopened.snapshotSkills(lar(reopened, 'decision').workId, 1, [])).toThrow(/never built/);
        expect(() => reopened.snapshotSkills(lar(reopened, 'bug').workId, 1, ['a', 'a'])).toThrow(/twice/);
        expect(() => reopened.snapshotSkills(lar(reopened, 'bug').workId, 1, ['has space'])).toThrow(/skill/);
        expect(() => reopened.update(build.workId, 2, { kind: 'concept' })).toThrow(/never built/);
    });
});

describe('work-record provider observations', () => {
    it('refreshes unchanged observations without resetting the age of the work', async () => {
        const records = await open();
        const made = records.create({
            title: 'Queued work',
            repository: 'maddec01/lar',
            kind: 'feature',
            ticket: 'maddec01/lar#7',
            status: 'Queued',
        });

        vi.useFakeTimers({ toFake: ['Date'] });

        try {
            vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));

            const observed = records.observe(made.workId, made.revision, {
                of: 'ticket',
                state: 'open',
                assignee: 'pedro',
            });

            vi.setSystemTime(new Date('2026-11-03T10:05:00Z'));

            const refreshed = records.observe(made.workId, observed.revision, {
                of: 'ticket',
                state: 'open',
                assignee: 'pedro',
            });

            expect(refreshed.updatedAt).toBe(observed.updatedAt);
            expect(refreshed.revision).toBe(observed.revision + 1);
            expect(records.observations(made.workId)[0]?.observedAt).toBe('2026-11-03T10:05:00.000Z');

            const changed = records.observe(made.workId, refreshed.revision, {
                of: 'ticket',
                state: 'open',
                assignee: 'ana',
            });

            expect(changed.updatedAt).toBe('2026-11-03T10:05:00.000Z');
            vi.setSystemTime(new Date('2026-11-03T10:07:00Z'));

            const failed = records.recordReadFailure(made.workId, changed.revision, 'ticket', 'Offline');

            expect(failed.updatedAt).toBe(changed.updatedAt);
            vi.setSystemTime(new Date('2026-11-03T10:10:00Z'));

            const failedAgain = records.recordReadFailure(
                made.workId,
                failed.revision,
                'ticket',
                'Connection timed out',
            );

            expect(failedAgain.updatedAt).toBe(failed.updatedAt);
            expect(records.observations(made.workId)[0]?.failedAt).toBe('2026-11-03T10:10:00.000Z');

            const recovered = records.observe(made.workId, failedAgain.revision, {
                of: 'ticket',
                state: 'open',
                assignee: 'ana',
            });

            expect(recovered.updatedAt).toBe(changed.updatedAt);
        } finally {
            vi.useRealTimers();
        }
    });

    const lar = (records: WorkRecords, kind: WorkKind, ticket?: string) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind, ticket });

    it("replaces the last observation of a ticket's state and assignee, and keeps it across reopen", async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const bug = lar(first, 'bug', 'maddec01/lar#7');

        first.observe(bug.workId, 1, { of: 'ticket', state: 'open', assignee: 'pedro' });
        expect(first.observe(bug.workId, 2, { of: 'ticket', state: 'closed' })).toMatchObject({
            revision: 3,
            finishedAt: null,
        });
        first.close();

        const reopened = await open(path);

        expect(reopened.observations(bug.workId)).toEqual([
            {
                of: 'ticket',
                subject: 'maddec01/lar#7',
                state: 'closed',
                assignee: null,
                observedAt: expect.any(String),
                failedAt: null,
                failure: null,
            },
        ]);
        reopened.observe(bug.workId, 3, { of: 'ticket', state: 'not-found' });
        expect(reopened.observations(bug.workId)).toMatchObject([{ state: 'not-found' }]);
        expect(() => reopened.observe(bug.workId, 3, { of: 'ticket', state: 'open' })).toThrow(
            expect.objectContaining({ code: 'stale-revision' }),
        );
    });

    it('observes the recorded PR, finishing the work when it merged, and drops the observation when the PR is replaced', async () => {
        const records = await open();
        const build = lar(records, 'build');

        records.setPullRequest(build.workId, 1, 'maddec01/lar#90');
        records.observe(build.workId, 2, { of: 'pr', state: 'closed' });
        expect(records.observations(build.workId)).toMatchObject([
            { of: 'pr', subject: 'maddec01/lar#90', state: 'closed' },
        ]);

        records.setPullRequest(build.workId, 3, 'maddec01/lar#91');
        expect(records.observations(build.workId)).toEqual([]);
        expect(records.observe(build.workId, 4, { of: 'pr', state: 'merged' })).toMatchObject({
            finishedAt: expect.any(String),
            revision: 5,
        });
        expect(records.observations(build.workId)).toMatchObject([{ subject: 'maddec01/lar#91', state: 'merged' }]);
    });
});

describe('work-record completion', () => {
    const lar = (records: WorkRecords, kind: WorkKind) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind });
    const at = (records: WorkRecords, workId: string) => records.read(workId).revision;
    /** Merges a new delivery PR for the build. */
    const merge = (records: WorkRecords, workId: string, pr: string) => {
        records.setPullRequest(workId, at(records, workId), pr);
        records.observe(workId, at(records, workId), { of: 'pr', state: 'merged' });
    };
    /** Makes a decision under `concept` complete: answer, domain drafts, then the concept's map. */
    const settle = (records: WorkRecords, decision: string, concept: string) => {
        records.setBody(decision, at(records, decision), 'answer', 'Use SQLite.');
        records.setBody(decision, at(records, decision), 'domain-drafts', 'None.');
        records.setBody(concept, at(records, concept), 'map', '# Map\n\nSettled.');
    };

    it('keeps refinement without delivery incomplete for blockers and retention', async () => {
        const records = await open();
        const concept = lar(records, 'concept');
        const dependent = lar(records, 'build');

        records.addBlocker(dependent.workId, 1, concept.workId);
        records.setBody(concept.workId, at(records, concept.workId), 'map', '# Map');
        records.setFogGone(concept.workId, at(records, concept.workId), true);
        expect(records.refinement(concept.workId).complete).toBe(true);
        expect(records.completion(concept.workId)).toEqual({ complete: false, reasons: ['No delivery planned.'] });
        expect(records.waitingOn(dependent.workId)).toHaveLength(1);
        expect(records.read(concept.workId).finishedAt).toBeNull();
    });

    it('rechecks refinement when decisions are rewritten or restored and Fog returns', async () => {
        const records = await open();
        const concept = lar(records, 'concept');
        const decision = lar(records, 'decision');

        records.setParent(decision.workId, 1, concept.workId);
        settle(records, decision.workId, concept.workId);
        records.setFogGone(concept.workId, at(records, concept.workId), true);
        expect(records.refinement(concept.workId).complete).toBe(true);
        records.setBody(decision.workId, at(records, decision.workId), 'answer', 'Use Postgres.');
        expect(records.refinement(concept.workId).complete).toBe(false);
        records.setAside(decision.workId, at(records, decision.workId));
        expect(records.refinement(concept.workId).complete).toBe(true);
        records.restore(decision.workId, at(records, decision.workId));
        expect(records.refinement(concept.workId).complete).toBe(false);
        settle(records, decision.workId, concept.workId);
        expect(records.refinement(concept.workId).complete).toBe(true);
        records.setFogGone(concept.workId, at(records, concept.workId), false);
        expect(records.refinement(concept.workId).complete).toBe(false);
    });

    it('completes a build only once its recorded PR is observed merged', async () => {
        const records = await open();
        const build = lar(records, 'build');

        expect(records.completion(build.workId)).toEqual({ complete: false, reasons: ['It has no recorded PR.'] });
        records.setPullRequest(build.workId, 1, 'maddec01/lar#90');
        records.observe(build.workId, 2, { of: 'pr', state: 'open' });
        expect(records.completion(build.workId)).toEqual({
            complete: false,
            reasons: ["Its PR maddec01/lar#90 isn't observed merged."],
        });
        records.observe(build.workId, 3, { of: 'pr', state: 'closed' });
        expect(records.completion(build.workId).complete).toBe(false);
        records.update(build.workId, 4, { status: 'Done' });
        expect(records.completion(build.workId).complete).toBe(false);

        records.observe(build.workId, 5, { of: 'pr', state: 'merged' });
        expect(records.completion(build.workId)).toEqual({ complete: true, reasons: [] });
        records.setPullRequest(build.workId, 6, 'maddec01/lar#91');
        expect(records.completion(build.workId)).toEqual({
            complete: false,
            reasons: ["Its PR maddec01/lar#91 isn't observed merged."],
        });
    });

    it('completes a concept once its Fog is gone, every decision is settled and every build is Done', async () => {
        const path = join(tempDir(), 'work-records.db');
        const records = await openWorkRecords(path);
        const [concept, decision, build, dropped] = [
            lar(records, 'concept'),
            lar(records, 'decision'),
            lar(records, 'build'),
            lar(records, 'build'),
        ];

        for (const child of [decision, build, dropped]) records.setParent(child.workId, 1, concept.workId);
        records.setAside(dropped.workId, 2);
        expect(records.completion(concept.workId)).toEqual({
            complete: false,
            reasons: [
                "Its Fog isn't gone.",
                `Its decision ${decision.workId} isn't settled.`,
                `Its build ${build.workId} isn't Done.`,
            ],
        });

        expect(records.setFogGone(concept.workId, at(records, concept.workId), true)).toMatchObject({ fogGone: true });
        settle(records, decision.workId, concept.workId);
        merge(records, build.workId, 'maddec01/lar#90');
        records.close();

        const reopened = await open(path);

        expect(reopened.completion(concept.workId)).toEqual({ complete: true, reasons: [] });
        reopened.setFogGone(concept.workId, at(reopened, concept.workId), false);
        expect(reopened.completion(concept.workId).reasons).toEqual(["Its Fog isn't gone."]);
        expect(() => reopened.setFogGone(build.workId, at(reopened, build.workId), true)).toThrow(/Only a concept/);
    });

    it('lets a dependent start once its blockers are complete, with no ticket closing', async () => {
        const records = await open();
        const [concept, decision, build, other] = [
            lar(records, 'concept'),
            lar(records, 'decision'),
            lar(records, 'build'),
            lar(records, 'build'),
        ];

        records.setParent(decision.workId, 1, concept.workId);
        records.addBlocker(build.workId, 1, decision.workId);
        records.addBlocker(build.workId, 2, other.workId);
        expect(records.waitingOn(build.workId)).toEqual([
            {
                workId: decision.workId,
                reasons: ["Its confirmed answer isn't recorded.", "Its domain drafts aren't recorded."],
            },
            { workId: other.workId, reasons: ['It has no recorded PR.'] },
        ]);

        settle(records, decision.workId, concept.workId);
        merge(records, other.workId, 'maddec01/lar#90');
        expect(records.waitingOn(build.workId)).toEqual([]);
        expect(records.read(build.workId).ticket).toBeNull();
    });
});

describe('work-record retention', () => {
    const lar = (records: WorkRecords, kind: WorkKind) =>
        records.create({ title: 'Work', repository: 'maddec01/lar', kind });
    /** `n` days after now. */
    const later = (n: number) => new Date(Date.now() + n * 86_400_000);
    const KEEP = { hideAfterDays: 7, deleteAfterDays: null };
    const ids = (list: readonly { workId: string }[]) => list.map((record) => record.workId);

    it('hides a finished or set-aside record after seven days and keeps it by default', async () => {
        const records = await open();
        const [finished, setAside, active] = [lar(records, 'build'), lar(records, 'feature'), lar(records, 'bug')];

        records.recordFinished(finished.workId, 1);
        records.setAside(setAside.workId, 1);

        expect(records.hidden(KEEP, later(6))).toEqual([]);
        expect(ids(records.hidden(KEEP, later(8)))).toEqual([finished.workId, setAside.workId]);
        expect(records.deleteExpired(KEEP, later(800))).toEqual({ deleted: [], kept: [] });
        expect(ids(records.list({}))).toEqual([finished.workId, setAside.workId, active.workId]);
    });

    it('deletes a finished record only after the chosen number of days, with its owned data', async () => {
        const records = await open();
        const build = lar(records, 'build');

        records.setBody(build.workId, 1, 'brief', '# Brief');
        records.recordReviewRound(build.workId, 2, {
            base: 'c8890a1a',
            reviewers: [
                {
                    axis: 'code',
                    verdict: 'changes',
                    findings: [{ severity: 'nit', summary: 'x', disposition: 'open' }],
                },
            ],
        });
        records.addThread(build.workId, 3, 'thread-1', 'build');
        records.recordLaunchIntent(build.workId, 4, 'build');
        records.setPullRequest(build.workId, 5, 'maddec01/lar#1');
        records.setPullRequest(build.workId, 6, 'maddec01/lar#2');
        records.observe(build.workId, 7, { of: 'pr', state: 'merged' });

        const setting = { hideAfterDays: 7, deleteAfterDays: 30 };

        expect(records.deleteExpired(setting, later(29))).toEqual({ deleted: [], kept: [] });
        expect(records.deleteExpired(setting, later(31))).toEqual({ deleted: [build.workId], kept: [] });
        expect(records.list({})).toEqual([]);
        expect(records.launchIntents({})).toEqual([]);

        // The thread ID is free again: no thread row was left behind.
        const other = lar(records, 'build');

        expect(records.addThread(other.workId, 1, 'thread-1', 'build')).toMatchObject({ revision: 2 });
    });

    it('never deletes active or unfinished work, even in Done without a recorded finish', async () => {
        const records = await open();
        const made = (['List', 'Queued', 'In progress', 'Done'] as const).map((status) =>
            records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'feature', status }),
        );

        expect(records.deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }, later(10_000))).toEqual({
            deleted: [],
            kept: [],
        });
        expect(ids(records.list({})).toSorted()).toEqual(ids(made).toSorted());
    });

    it('keeps a finished build while it owns an unfinished slice, and says why', async () => {
        const records = await open();
        const [build, done, open_] = [lar(records, 'build'), lar(records, 'slice'), lar(records, 'slice')];

        records.setParent(done.workId, 1, build.workId);
        records.setParent(open_.workId, 1, build.workId);
        records.recordFinished(done.workId, 2);
        records.recordFinished(build.workId, 3);

        const result = records.deleteExpired({ hideAfterDays: 7, deleteAfterDays: 30 }, later(31));

        expect(result).toEqual({
            deleted: [done.workId],
            kept: [{ workId: build.workId, reason: `It owns the slice ${open_.workId}, which is kept.` }],
        });
        expect(records.children(build.workId)).toMatchObject([{ workId: open_.workId }]);
        expect(records.read(build.workId).revision).toBe(5);
    });

    it('keeps a finished record another kept record waits on, and deletes both once neither is needed', async () => {
        const records = await open();
        const [blocker, waiting] = [lar(records, 'build'), lar(records, 'build')];

        records.addBlocker(waiting.workId, 1, blocker.workId);
        records.recordFinished(blocker.workId, 2);

        const setting = { hideAfterDays: 7, deleteAfterDays: 30 };

        expect(records.deleteExpired(setting, later(31))).toEqual({
            deleted: [],
            kept: [{ workId: blocker.workId, reason: `The build ${waiting.workId}, which is kept, waits on it.` }],
        });
        records.recordFinished(waiting.workId, 2);
        expect(records.deleteExpired(setting, later(31)).deleted.toSorted()).toEqual(
            [blocker.workId, waiting.workId].toSorted(),
        );
        expect(records.list({})).toEqual([]);
    });
});

it('restores imported refinement and relationships atomically and preserves later local removals', async () => {
    const records = await open();
    const concept = records.create({ title: 'Concept', repository: 'team/repo', kind: 'concept' });
    const build = records.create({ title: 'Build', repository: 'team/repo', kind: 'build' });
    const blocker = records.create({ title: 'Blocker', repository: 'team/repo', kind: 'build' });

    expect(() =>
        records.restoreImported(build.workId, build.revision, {
            body: 'brief',
            markdown: 'Imported brief',
            parentId: concept.workId,
            blockerIds: [blocker.workId, 'missing'],
        }),
    ).toThrow('No work record has the work ID "missing".');
    expect(records.body(build.workId, 'brief')).toBe(null);
    expect(records.read(build.workId)).toEqual(build);
    expect(records.children(concept.workId)).toEqual([]);
    expect(records.blockers(build.workId)).toEqual([]);

    const restored = records.restoreImported(build.workId, build.revision, {
        body: 'brief',
        markdown: 'Imported brief',
        parentId: concept.workId,
        blockerIds: [blocker.workId],
    });

    expect(records.body(build.workId, 'brief')).toBe('Imported brief');
    expect(restored.parentId).toBe(concept.workId);
    expect(records.blockers(build.workId).map((record) => record.workId)).toEqual([blocker.workId]);
    records.clearParent(build.workId, restored.revision);
    records.removeBlocker(build.workId, records.read(build.workId).revision, blocker.workId);
    records.setBody(build.workId, records.read(build.workId).revision, 'brief', 'Local brief');

    const before = records.read(build.workId);

    expect(
        records.restoreImported(build.workId, before.revision, {
            body: 'brief',
            markdown: 'Provider edit',
            parentId: concept.workId,
            blockerIds: [blocker.workId],
        }),
    ).toEqual(before);
    expect(records.body(build.workId, 'brief')).toBe('Local brief');
    expect(records.read(build.workId).parentId).toBe(null);
    expect(records.blockers(build.workId)).toEqual([]);
});

it('invalidates gates without losing evidence or brief text', async () => {
    const records = await open();
    const build = records.create({ title: 'Build', repository: 'a/b', kind: 'build' });

    records.setBody(build.workId, 1, 'brief', 'Build this.');

    const gate = records.gate(build.workId);

    records.recordGate(build.workId, 2, { briefDigest: gate.briefDigest!, approvedBy: 'person', evidence: 'Passed' });
    records.invalidateGate(build.workId, 2);
    expect(records.gate(build.workId)).toMatchObject({ current: false, evidence: [expect.any(Object)] });
    expect(() => records.invalidateGate(build.workId, 2)).toThrow(/is at revision 3, not 2; read it again/);
    records.recordGate(build.workId, 3, {
        briefDigest: gate.briefDigest!,
        approvedBy: 'person',
        evidence: 'Passed again',
    });
    expect(records.gate(build.workId).current).toBe(true);
});

it('resets only slices owned by the selected build', async () => {
    const records = await open();
    const build = records.create({ title: 'Build', repository: 'a/b', kind: 'build' });
    const slice = records.create({ title: 'Slice', repository: 'a/b', kind: 'slice' });
    const other = records.create({ title: 'Other', repository: 'a/b', kind: 'slice' });

    records.setParent(slice.workId, 1, build.workId);
    expect(() => records.resetBuild(build.workId, 1)).toThrow(/is at revision 2, not 1; read it again/);
    records.resetBuild(build.workId, 2);
    expect(() => records.read(slice.workId)).toThrow(/No work record has the work ID/);
    expect(records.read(other.workId).workId).toBe(other.workId);
});

it('preserves cleanup names across reset and database reopen with revision protection', async () => {
    const path = join(tempDir(), 'work-records.db');
    const records = await open(path);
    const build = records.create({ title: 'Build', repository: 'a/b', kind: 'build' });
    const slice = records.create({ title: 'Slice', repository: 'a/b', kind: 'slice' });

    records.setParent(slice.workId, 1, build.workId);
    records.setBuildBranch(build.workId, 2, 'old-build');

    const name = `slice/${slice.workId.slice(0, 8)}-work`;

    expect(() => records.captureCleanup(build.workId, 2, 'fallback', [name])).toThrow(
        /is at revision 3, not 2; read it again/,
    );
    expect(() => records.captureCleanup(build.workId, 3, 'fallback', ['slice/unrelated-work'])).toThrow(
        'Cleanup branch is not owned by this build.',
    );
    records.captureCleanup(build.workId, 3, 'fallback', [name]);
    records.resetBuild(build.workId, 4);
    records.setBuildBranch(build.workId, 5, 'new-build');

    const reopened = await open(path);

    expect(reopened.cleanupOwnership(build.workId)).toEqual([
        { branch: 'old-build', sliceIds: [slice.workId], sliceBranches: [name] },
    ]);
});

it('commits staged recovery only after a confirmed launch across reopen', async () => {
    const path = join(tempDir(), 'recovery.db');
    const records = await openWorkRecords(path);
    const build = records.create({ title: 'Recovery', repository: 'a/b', kind: 'build' });
    const slice = records.create({ title: 'Slice', repository: 'a/b', kind: 'slice' });

    records.setParent(slice.workId, slice.revision, build.workId);

    let current = records.setBuildBranch(build.workId, records.read(build.workId).revision, 'old');

    current = records.setBuildPhase(build.workId, current.revision, 'implement');

    const failed = records.recordLaunchIntent(build.workId, current.revision, 'build', {
        branch: 'new-failed',
        reset: true,
    });

    current = records.resolveLaunchIntent(build.workId, failed.record.revision, failed.intent.intentId, {
        failure: 'refused',
    }).record;
    expect(current).toMatchObject({ buildBranch: 'old', buildPhase: 'implement' });
    expect(records.children(build.workId)).toHaveLength(1);
    current = records.setNeedsYouCauses(build.workId, current.revision, [{ type: 'no-thread' }]);

    const staged = records.recordLaunchIntent(build.workId, current.revision, 'build', {
        branch: 'new-confirmed',
        reset: true,
    });

    records.close();

    const reopened = await openWorkRecords(path);

    current = reopened.resolveLaunchIntent(build.workId, staged.record.revision, staged.intent.intentId, {
        threadId: 'confirmed',
    }).record;
    expect(current).toMatchObject({ buildBranch: 'new-confirmed', buildPhase: 'plan', needsYouCauses: [] });
    expect(reopened.children(build.workId)).toEqual([]);
    reopened.close();
});

describe('shaping thread cleanup rows', () => {
    /** A build with shaping threads `shaped`, and a resolved build thread for `choice`. */
    const started = async (
        choice: Parameters<WorkRecords['recordLaunchIntent']>[4],
        shaped = ['shape-1', 'shape-2'],
    ) => {
        const records = await open();
        const build = records.create({ title: 'Build', kind: 'build', repository: 'a/b' });

        for (const thread of shaped)
            records.addThread(build.workId, records.read(build.workId).revision, thread, 'shape');

        const startBuild = (thread: string, saved = choice) => {
            const { intent } = records.recordLaunchIntent(
                build.workId,
                records.read(build.workId).revision,
                'build',
                undefined,
                saved,
            );

            records.resolveLaunchIntent(build.workId, records.read(build.workId).revision, intent.intentId, {
                threadId: thread,
            });
        };

        return { records, build, startBuild };
    };
    const pendingIds = (records: WorkRecords) => records.pendingShapingThreadCleanups().map((row) => row.threadId);

    it('holds one pending row per shaping thread once a build thread is recorded, with the saved action', async () => {
        const { records, startBuild } = await started('archive');

        expect(records.pendingShapingThreadCleanups()).toEqual([]);
        startBuild('build-1');

        const rows = records.pendingShapingThreadCleanups();

        expect(rows.map(({ threadId, action, failure }) => ({ threadId, action, failure }))).toEqual([
            { threadId: 'shape-1', action: 'archive', failure: null },
            { threadId: 'shape-2', action: 'archive', failure: null },
        ]);
        expect(new Set(rows.map((row) => row.commandId)).size).toBe(2);
    });

    it('records a Keep as already cleaned, so a later build under another setting leaves that thread alone', async () => {
        const { records, build, startBuild } = await started('keep');

        startBuild('build-1');
        expect(pendingIds(records)).toEqual([]);
        records.addThread(build.workId, records.read(build.workId).revision, 'shape-3', 'shape');
        startBuild('build-2', 'archive');
        expect(pendingIds(records)).toEqual(['shape-3']);
    });

    it('touches only threads without a row, skips deleted threads and keeps a cleaned thread cleaned', async () => {
        const { records, build, startBuild } = await started('archive');

        records.confirmThreadDeleted(build.workId, records.read(build.workId).revision, 'shape-2');
        startBuild('build-1');

        const [first] = records.pendingShapingThreadCleanups();

        expect(pendingIds(records)).toEqual(['shape-1']);
        records.markShapingThreadCleaned('shape-1');
        records.addThread(build.workId, records.read(build.workId).revision, 'shape-3', 'shape');
        startBuild('build-2');
        expect(pendingIds(records)).toEqual(['shape-3']);
        expect(records.pendingShapingThreadCleanups()[0]!.commandId).not.toBe(first!.commandId);
    });

    it('saves and clears a failure with no change to the revision, and survives reopening', async () => {
        const path = join(tempDir(), 'work-records.db');
        const first = await openWorkRecords(path);
        const build = first.create({ title: 'Build', kind: 'build', repository: 'a/b' });

        first.addThread(build.workId, 1, 'shape-1', 'shape');

        const { intent } = first.recordLaunchIntent(build.workId, 2, 'build', undefined, 'archive');

        first.resolveLaunchIntent(build.workId, 3, intent.intentId, { threadId: 'build-1' });

        const revision = first.read(build.workId).revision;
        const [row] = first.pendingShapingThreadCleanups();

        first.saveShapingThreadFailure('shape-1', 'T3 refused it.');
        expect(first.read(build.workId).revision).toBe(revision);
        first.close();

        const reopened = await open(path);

        expect(reopened.pendingShapingThreadCleanups()).toEqual([{ ...row, failure: 'T3 refused it.' }]);
        reopened.saveShapingThreadFailure('shape-1', null);
        expect(reopened.pendingShapingThreadCleanups()[0]!.failure).toBeNull();
        reopened.saveShapingThreadFailure('shape-1', 'Again.');
        reopened.markShapingThreadCleaned('shape-1');
        expect(reopened.pendingShapingThreadCleanups()).toEqual([]);
        expect(reopened.read(build.workId).revision).toBe(revision);
    });

    it('lists rows of set-aside records, removes them with the record, and keeps them through resetBuild', async () => {
        const { records, build, startBuild } = await started('archive', ['shape-1']);

        startBuild('build-1');
        records.resetBuild(build.workId, records.read(build.workId).revision);
        expect(pendingIds(records)).toEqual(['shape-1']);
        records.setAside(build.workId, records.read(build.workId).revision);
        expect(pendingIds(records)).toEqual(['shape-1']);
        records.deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }, new Date(Date.now() + 86_400_000));
        expect(pendingIds(records)).toEqual([]);
    });
});

describe('launch moves and repeated Statuses', () => {
    it('moves Queued work to Shaping and Ready work to In progress when a matching intent gets its thread', async () => {
        const records = await open();
        const shaped = records.create({
            title: 'Shape',
            repository: 'maddec01/lar',
            kind: 'concept',
            status: 'Queued',
        });
        const { intent: shape } = records.recordLaunchIntent(shaped.workId, shaped.revision, 'shape');

        expect(
            records.resolveLaunchIntent(shaped.workId, shaped.revision + 1, shape.intentId, { threadId: 'a' }).record
                .status,
        ).toBe('Shaping');

        const built = records.create({ title: 'Build', repository: 'maddec01/lar', kind: 'build', status: 'Ready' });
        const { intent: build } = records.recordLaunchIntent(built.workId, built.revision, 'build');

        expect(
            records.resolveLaunchIntent(built.workId, built.revision + 1, build.intentId, { threadId: 'b' }).record
                .status,
        ).toBe('In progress');
    });
});
