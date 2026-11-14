import { defaultFactorySettings } from '@lar-factory/shared/factory-settings';
import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    mkdirSync,
    mkdtempSync,
    renameSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { writeFactorySettings } from './factory-settings.ts';
import { readReviewerDiff } from './reviewer-diff.ts';
import { openWorkRecords, workRecordsPath } from './work-records.ts';

const dirs: string[] = [];
const directory = () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-reviewers-'));

    dirs.push(dir);

    return dir;
};

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repository() {
    const cwd = directory();
    const git = (...args: string[]) =>
        execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

    git('init');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'core.hooksPath', '/dev/null');

    const commit = () => {
        git('add', '-A');
        git('commit', '-m', 'test', '--allow-empty');

        return git('rev-parse', 'HEAD');
    };

    return { cwd, git, commit };
}

it('reads an exact pair including deleted and renamed paths, binary, odd filenames and removed text; ignores dirty files', () => {
    const { cwd, git, commit } = repository();

    writeFileSync(join(cwd, 'auth.ts'), 'fetch(url);\n');
    writeFileSync(join(cwd, 'old.ts'), 'unchanged();\n');

    const base = commit();

    rmSync(join(cwd, 'auth.ts'));
    renameSync(join(cwd, 'old.ts'), join(cwd, 'new.ts'));
    writeFileSync(join(cwd, 'odd\nname.ts'), 'call();\n');
    writeFileSync(join(cwd, 'binary'), Buffer.from([0, 1, 2]));

    const head = commit();

    writeFileSync(join(cwd, 'dirty.ts'), 'fetch(secret);\n');
    git('config', 'diff.external', 'must-not-execute');
    git('config', 'diff.noprefix', 'true');

    const { diff } = readReviewerDiff(base, head, cwd);

    expect(diff.complete).toBe(true);
    expect(diff.files).toEqual([
        { path: 'auth.ts', text: 'fetch(url);' },
        { path: 'binary', text: null },
        { path: 'new.ts', text: 'unchanged();' },
        { path: 'odd\nname.ts', text: 'call();' },
        { path: 'old.ts', text: 'unchanged();' },
    ]);
    expect(readReviewerDiff(head, head, cwd).diff.files).toEqual([]);
    expect(() => readReviewerDiff('--help', head, cwd)).toThrow('full lowercase');
    expect(() => readReviewerDiff('a'.repeat(40), head, cwd)).toThrow('unavailable');
});

it('treats executable-mode changes as uncertain content so permission changes cannot silently skip Security', () => {
    const { cwd, commit } = repository();

    writeFileSync(join(cwd, 'ordinary.ts'), 'return left + right;\n');

    const base = commit();

    chmodSync(join(cwd, 'ordinary.ts'), 0o755);

    const head = commit();

    expect(readReviewerDiff(base, head, cwd).diff.files).toEqual([{ path: 'ordinary.ts', text: null }]);
});

it('treats a changed existing symlink target as uncertain rather than source code', () => {
    const { cwd, commit } = repository();
    const link = join(cwd, 'ordinary.ts');

    symlinkSync('first', link);

    const base = commit();

    rmSync(link);
    symlinkSync('second', link);

    const head = commit();

    expect(readReviewerDiff(base, head, cwd).diff.files).toEqual([{ path: 'ordinary.ts', text: null }]);
});

it('returns uncertain text for invalid UTF-8, without silently replacing bytes', () => {
    const { cwd, commit } = repository();
    const base = commit();

    writeFileSync(join(cwd, 'README.md'), Buffer.from([0xff, 0xfe, 0x61]));

    const head = commit();

    expect(readReviewerDiff(base, head, cwd).diff.files).toEqual([{ path: 'README.md', text: null }]);
});

it('selects through the CLI with saved modes and custom rules, atomically starting Review without tracker sync', async () => {
    const { cwd, commit } = repository();
    const data = directory();
    const records = await openWorkRecords(workRecordsPath(data));
    const record = records.create({ title: 'Review fixture', repository: 'example/repo', kind: 'feature' });
    const before = records.read(record.workId);

    records.close();

    const settings = defaultFactorySettings();

    settings.reviewers[0]!.mode = { kind: 'never' };
    settings.reviewers.push({
        id: 'compatibility',
        name: 'Compatibility',
        mode: {
            kind: 'on-trigger',
            trigger: {
                version: 1,
                kind: 'rules',
                any: [{ target: 'diff-text', pattern: 'oldCall' }],
            },
        },
        instructions: { kind: 'revision', revision: 1 },
        revisions: [{ revision: 1, text: 'Check callers.' }],
    });
    writeFactorySettings(settings, data);
    writeFileSync(join(cwd, 'README.md'), 'fetch(url);\noldCall\n');

    const base = commit();

    writeFileSync(join(cwd, 'README.md'), 'fetch(url);\nnewCall\n');

    const head = commit();

    mkdirSync(join(cwd, 'nested'));

    const command = [
        '--disable-warning=ExperimentalWarning',
        join(import.meta.dirname, 'cli.ts'),
        'select-reviewers',
        record.workId,
        '--base',
        base,
        '--head',
        head,
        '--data-dir',
        data,
    ];
    const run = () =>
        execFileSync(process.execPath, command, {
            cwd: join(cwd, 'nested'),
            encoding: 'utf8',
            env: { ...process.env, GH_PATH: '/unavailable/gh' },
        });
    const output = run();

    writeFileSync(join(cwd, '.gitattributes'), '*.md binary\n');
    expect(run()).toBe(output);

    const selection = JSON.parse(output);

    expect(selection).toMatchObject({
        workId: record.workId,
        base,
        head,
        root: realpathSync(cwd),
        complete: true,
        triggerVersion: 1,
    });
    expect(
        selection.reviewers.filter((entry: { run: boolean }) => entry.run).map((entry: { id: string }) => entry.id),
    ).toEqual(['compatibility']);

    const reopened = await openWorkRecords(workRecordsPath(data));

    expect(reopened.read(record.workId)).toMatchObject({
        status: 'Review',
        buildPhase: 'review',
        revision: before.revision + 2,
    });
    expect(reopened.reviewRounds(record.workId)).toEqual([]);
    reopened.close();
}, 30_000);

it('accepts Code requests through the CLI and saves their provenance with the resulting round', async () => {
    const { cwd, commit } = repository();
    const data = directory();
    const records = await openWorkRecords(workRecordsPath(data));
    const record = records.create({ title: 'Escalation fixture', repository: 'example/repo', kind: 'feature' });

    records.close();

    const settings = defaultFactorySettings();

    settings.reviewers.find((entry) => entry.id === 'ui')!.mode = { kind: 'never' };
    writeFactorySettings(settings, data);

    const base = commit();

    writeFileSync(join(cwd, 'helper.ts'), 'verifyCaller();\n');

    const head = commit();
    const escalation = { requestedBy: 'code', reason: 'verifyCaller changes auth.' };
    const request = { reviewer: 'security', ...escalation };
    const file = join(data, 'requests.json');

    writeFileSync(
        file,
        JSON.stringify([request, request, { ...request, reviewer: 'ui' }, { ...request, reviewer: 'code' }]),
    );

    const run = (...args: string[]) =>
        JSON.parse(
            execFileSync(
                process.execPath,
                [
                    '--disable-warning=ExperimentalWarning',
                    join(import.meta.dirname, 'cli.ts'),
                    ...args,
                    '--data-dir',
                    data,
                ],
                { cwd, encoding: 'utf8' },
            ),
        );
    const selected = run('select-reviewers', record.workId, '--base', base, '--head', head, '--escalations', file);
    const reviewers = selected.reviewers as { id: string; run: boolean; reason: string; escalation?: unknown }[];

    expect(reviewers.filter((entry) => entry.escalation).map((entry) => entry.id)).toEqual(['security']);
    expect(reviewers.filter((entry) => entry.run).map((entry) => entry.id)).toEqual(['code', 'security']);
    expect(run('read', record.workId).revision).toBe(3);

    const roundFile = join(data, 'round.json');

    writeFileSync(
        roundFile,
        JSON.stringify({
            base,
            reviewers: reviewers.map((entry) => ({
                axis: entry.id,
                verdict: entry.run ? 'approve' : 'skipped',
                findings: [],
                notChecked: entry.run ? undefined : entry.reason,
                escalation: entry.escalation,
            })),
        }),
    );
    expect(run('record-review-round', record.workId, '--revision', '3', '--file', roundFile).revision).toBe(4);
    expect(
        run('review-rounds', record.workId)[0].reviewers.find((entry: { axis: string }) => entry.axis === 'security'),
    ).toMatchObject({ verdict: 'approve', escalation });
}, 30_000);

it('selects from the named run after Settings edits, returning frozen instructions and role targets', async () => {
    const { cwd, commit } = repository();
    const data = directory();
    const records = await openWorkRecords(workRecordsPath(data));
    const record = records.create({ title: 'Frozen review', repository: 'example/repo', kind: 'build' });
    const settings = defaultFactorySettings();

    settings.roles['reviewer:code'] = { model: { instanceId: 'claude', model: 'opus' }, effort: 'high' };
    writeFactorySettings(settings, data);
    records.snapshotRun(record.workId, record.revision, {
        runId: 'build-run',
        kind: 'build',
        skills: [],
        packaged: {
            version: 'fixture',
            reviewers: { code: 'Frozen code instructions', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
    });

    const before = records.read(record.workId);

    records.close();
    settings.reviewers[0]!.mode = { kind: 'never' };
    writeFactorySettings(settings, data);

    const base = commit();

    writeFileSync(join(cwd, 'README.md'), 'Documentation.\n');

    const head = commit();
    const command = [
        '--disable-warning=ExperimentalWarning',
        join(import.meta.dirname, 'cli.ts'),
        'select-reviewers',
        record.workId,
        '--base',
        base,
        '--head',
        head,
        '--data-dir',
        data,
    ];
    const run = (...args: string[]) =>
        execFileSync(process.execPath, [...command, ...args], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
    const output = JSON.parse(run('--run-id', 'build-run'));
    const code = output.reviewers.find((reviewer: { id: string }) => reviewer.id === 'code');

    expect(output.runId).toBe('build-run');
    expect(code).toMatchObject({
        run: true,
        instructions: { text: 'Frozen code instructions', source: { version: 'fixture' } },
        target: { model: { instanceId: 'claude', model: 'opus' }, effort: 'high' },
    });
    expect(() => run()).toThrow(/requires --run-id/);
    expect(() => run('--run-id', 'missing')).toThrow(/No run/);

    const reread = await openWorkRecords(workRecordsPath(data));

    try {
        expect(reread.read(record.workId)).toMatchObject({
            status: 'Review',
            buildPhase: 'review',
            revision: before.revision + 2,
        });
    } finally {
        reread.close();
    }
}, 30_000);

it('S03 Verify return selects on the delta since the last reviewed head and records that scope', async () => {
    const { cwd, commit } = repository();
    const data = directory();
    const records = await openWorkRecords(workRecordsPath(data));
    let work = records.create({
        title: 'Verify return',
        repository: 'example/repo',
        kind: 'feature',
        status: 'Verify',
    });
    const base = commit();

    writeFileSync(join(cwd, 'index.html'), '<button>Run greeting</button>\n');

    const reviewed = commit();

    records.recordReviewRound(work.workId, work.revision, {
        base: reviewed,
        reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }],
    });
    work = records.setPullRequest(work.workId, records.read(work.workId).revision, 'example/repo#8');
    work = records.addThread(work.workId, work.revision, 'build-owner', 'build');
    records.observeVerificationHead(work.workId, work.pullRequest!, reviewed);
    records.recordVerification(work.workId, records.read(work.workId).revision, {
        pr: work.pullRequest!,
        head: reviewed,
        result: 'fail',
        note: 'Clarify documentation.',
        testSteps: 'Press greeting.',
        by: 'Pedro',
    });
    writeFileSync(join(cwd, 'README.md'), 'Greeting instructions.\n');

    const head = commit();

    records.close();

    const run = (...args: string[]) =>
        JSON.parse(
            execFileSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args, '--data-dir', data], {
                cwd,
                encoding: 'utf8',
            }),
        );
    const selection = run('select-reviewers', work.workId, '--base', base, '--head', head);

    expect(selection).toMatchObject({ base: reviewed, head, triggerVersion: 2 });
    expect(run('select-reviewers', work.workId, '--base', base, '--head', head)).toEqual(selection);
    expect(selection.reviewers.filter((r: { run: boolean }) => r.run).map((r: { id: string }) => r.id)).toEqual([
        'code',
    ]);
    expect(
        selection.reviewers.every((r: { reason: string }) =>
            r.reason.includes(`Verify rejection; delta ${reviewed}..${head}`),
        ),
    ).toBe(true);

    const round = join(data, 'return.json');

    writeFileSync(
        round,
        JSON.stringify({ base: head, reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }] }),
    );
    run('record-review-round', work.workId, '--revision', String(run('read', work.workId).revision), '--file', round);

    const saved = run('review-rounds', work.workId)[1];

    writeFileSync(join(cwd, 'index.html'), '<button>Check greeting</button>\n');

    const visible = commit();
    const next = run('select-reviewers', work.workId, '--base', base, '--head', visible);

    expect(next.base).toBe(head);
    expect(next.reviewers.filter((r: { run: boolean }) => r.run).map((r: { id: string }) => r.id)).toEqual([
        'code',
        'performance',
        'ui',
    ]);
    writeFileSync(
        round,
        JSON.stringify({ base: visible, reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }] }),
    );
    expect(() =>
        run(
            'record-review-round',
            work.workId,
            '--revision',
            String(run('read', work.workId).revision),
            '--file',
            round,
        ),
    ).toThrow(/Missing results/);

    expect(saved.reviewers).toHaveLength(4);
    expect(saved.reviewers.find((r: { axis: string }) => r.axis === 'ui')).toMatchObject({
        verdict: 'skipped',
        selection: { triggerVersion: 2, reason: expect.stringContaining('Verify rejection; delta') },
    });
}, 30_000);
