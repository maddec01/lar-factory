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

it('selects through the CLI with saved modes, custom rules and no record mutation or tracker sync', async () => {
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

    expect(reopened.read(record.workId)).toEqual(before);
    expect(reopened.reviewRounds(record.workId)).toEqual([]);
    reopened.close();
}, 30_000);
