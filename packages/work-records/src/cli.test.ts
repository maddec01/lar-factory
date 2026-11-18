import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { openWorkRecords } from './work-records.ts';

const CLI = join(import.meta.dirname, 'cli.ts');
const dirs: string[] = [];
const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-work-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs lar-work from an empty folder, with HOME pointed at another, as a thread would with the board closed. */
async function larWork(dataDir: string, ...args: string[]) {
    const cwd = tempDir();

    try {
        const { stdout, stderr } = await promisify(execFile)(
            process.execPath,
            ['--disable-warning=ExperimentalWarning', CLI, ...args, '--data-dir', dataDir],
            {
                cwd,
                env: { ...process.env, HOME: cwd },
                // A stuck invocation must terminate before the integration test's deadline.
                timeout: 10_000,
            },
        );

        return { code: 0, stdout, stderr, record: /^[[{]/.test(stdout) ? JSON.parse(stdout) : null };
    } catch (error) {
        const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };

        return { code, stdout, stderr, record: null };
    }
}

// Each run starts a Node process, about a second apiece.
describe('lar-work', { timeout: 30_000 }, () => {
    it('applies concurrent disjoint commands and gives actionable field conflicts', async () => {
        const data = tempDir();
        const records = await openWorkRecords(join(data, 'work-records.db'));
        const build = records.create({ title: 'Build', repository: 'example/product', kind: 'build' });

        try {
            const results = await Promise.all([
                larWork(data, 'set-phase', build.workId, '--revision', '1', '--phase', 'checks'),
                larWork(
                    data,
                    'set-needs-you',
                    build.workId,
                    '--revision',
                    '1',
                    '--reason',
                    'Should search match whole words?',
                ),
            ]);

            expect(results.map((result) => result.code)).toEqual([0, 0]);
            expect(records.read(build.workId)).toMatchObject({
                revision: 3,
                buildPhase: 'checks',
                needsYou: 'Should search match whole words?',
            });

            const refused = await larWork(data, 'set-phase', build.workId, '--revision', '1', '--phase', 'review');

            expect(refused.code).toBe(1);
            expect(refused.stderr).toContain('conflicting fields: buildPhase');
            expect(refused.stderr).toContain('Reread the record and decide whether to reapply');
            expect(records.read(build.workId).revision).toBe(3);
        } finally {
            records.close();
        }
    });

    it('has no build-overlap command', async () => {
        const result = await larWork(tempDir(), 'build-overlap', 'work');

        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain('Unknown command "build-overlap"');
    });

    it('creates, reads and updates a record in a data folder with no board running', async () => {
        const data = join(tempDir(), 'Lar Factory');
        const created = await larWork(
            data,
            'create',
            '--title',
            'Work',
            '--repository',
            'acme/core',
            '--kind',
            'feature',
        );

        expect(created).toMatchObject({ code: 0, record: { repository: 'acme/core', status: 'List', revision: 1 } });

        const { workId } = created.record;

        const updated = await larWork(data, 'update', workId, '--revision', '1', '--status', 'Queued');

        expect(updated.record).toMatchObject({ workId, status: 'Queued', queueOrder: 1, revision: 2 });
        expect((await larWork(data, 'read', workId)).record).toEqual(updated.record);
        expect((await larWork(data, 'list', '--status', 'Queued')).record).toEqual([updated.record]);
        expect(readdirSync(data)).toContain('work-records.db');
    });
});

it('gate reports held-edit status without exposing untrusted tracker text to the shaping agent', async () => {
    const data = tempDir();
    const records = await openWorkRecords(join(data, 'work-records.db'));
    let record = records.create({
        title: 'Work',
        repository: 'example/widget',
        kind: 'feature',
        ticket: 'example/widget#7',
    });

    record = records.setBody(
        record.workId,
        record.revision,
        'brief',
        completeBrief(
            '## Done when\nTrusted brief.\n### Tests\n`test/widget.test.ts`: preserves trusted values.\n## Scope\n### Files\n`widget.ts`',
        ),
    );

    const state = records.specState(record.workId);

    records.saveSpecState(record.workId, state.generation, {
        ...state,
        active: true,
        held: { body: 'HOSTILE TRACKER INSTRUCTIONS', title: 'Hostile title', version: '2', digest: 'held' },
        warning: 'A GitHub edit waits for approval.',
    });
    records.close();

    const reply = await larWork(data, 'gate', record.workId);

    expect(reply.code).toBe(0);
    expect(reply.record.specSync.awaitingApproval).toBe(true);
    expect(reply.stdout).not.toContain('HOSTILE TRACKER INSTRUCTIONS');
    expect(reply.stdout).not.toContain('Hostile title');
});

it(
    'refuses agent-authored batch approvals, including a fresh manifest and alleged human evidence',
    { timeout: 30_000 },
    async () => {
        const data = tempDir();
        const records = await openWorkRecords(join(data, 'work-records.db'));
        const ids: string[] = [];

        try {
            for (let index = 0; index < 2; index++) {
                const work = records.create({ title: `Build ${index}`, repository: 'fake/app', kind: 'build' });

                records.setBody(work.workId, work.revision, 'brief', completeBrief(`Complete brief ${index}.`));

                const input = records.doubtPackage(work.workId);

                records.recordDoubt(work.workId, input.packageDigest, 'Doubt', 'Code checked; clean.');
                ids.push(work.workId);
            }

            const idsFile = join(data, 'ids.json');
            const manifestFile = join(data, 'manifest.json');

            writeFileSync(idsFile, JSON.stringify(ids));

            const displayed = await larWork(data, 'gate-batch', '--file', idsFile);

            expect(displayed.code).toBe(0);
            expect(displayed.record.members).toHaveLength(2);
            writeFileSync(manifestFile, JSON.stringify(displayed.record));

            const last = records.read(ids[1]!);

            records.setBody(last.workId, last.revision, 'brief', completeBrief('Changed after display.'));

            const approve = (digest: string) =>
                larWork(
                    data,
                    'record-gate-batch',
                    '--file',
                    manifestFile,
                    '--digest',
                    digest,
                    '--identity',
                    'User',
                    '--evidence',
                    'Yes to the displayed batch.',
                );

            expect(await approve(displayed.record.digest)).toMatchObject({
                code: 1,
                stderr: expect.stringContaining('requires the user'),
            });
            expect(ids.every((id) => records.gate(id).evidence.length === 0)).toBe(true);

            const input = records.doubtPackage(last.workId);

            records.recordDoubt(last.workId, input.packageDigest, 'Doubt', 'Rechecked; clean.');

            const renewed = await larWork(data, 'gate-batch', '--file', idsFile);

            writeFileSync(manifestFile, JSON.stringify(renewed.record));

            const waiting = await larWork(
                data,
                'set-needs-you',
                ids[0]!,
                '--revision',
                String(records.read(ids[0]!).revision),
                '--reason',
                'Should search match whole words?',
            );

            expect(waiting.code).toBe(0);
            expect(
                (
                    await larWork(
                        data,
                        'clear-needs-you',
                        ids[0]!,
                        '--revision',
                        String(waiting.record.revision),
                        '--status',
                        'Shaping',
                    )
                ).code,
            ).toBe(0);

            const result = await approve(renewed.record.digest);

            expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining('recorded board control') });
            expect(ids.every((id) => records.gate(id).evidence.length === 0)).toBe(true);
        } finally {
            records.close();
        }
    },
);
