import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vite-plus/test';

import { writeHeavyCommandLimit } from './heavy-command-limit.ts';
import { alive, helperStart, stopHelpers } from './helper-processes.ts';
import { openWorkRecords } from './work-records.ts';
// Commands that run until the test ends them: one by SIGTERM, one by a file named go in its folder.
const signalledCommand = (cwd: string) =>
    `${helperStart(cwd)} process.on("SIGTERM", () => setTimeout(() => { console.log("finished"); process.exit(23); }, 100)); console.log("ready"); setInterval(() => {}, 1000)`;
async function loggedHelper(cwd: string) {
    for (
        const deadline = Date.now() + 15_000;
        Date.now() < deadline;
        await new Promise((done) => setTimeout(done, 20))
    ) {
        const started =
            existsSync(join(cwd, 'log')) && /^start helper (\d+)/.exec(readFileSync(join(cwd, 'log'), 'utf8'));
        if (started) return Number(started[1]);
    }
    throw Error('The helper never started.');
}
const gatedCommand = (cwd: string) =>
    `${helperStart(cwd)} console.log("ready"); setInterval(() => { if (require("fs").existsSync("go")) process.exit(27); }, 20)`;
it('passes child arguments and status through even without a database', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'check-runner-'));
    try {
        const result = spawnSync(
            process.execPath,
            [
                join(import.meta.dirname, 'cli.ts'),
                'run-check',
                'missing',
                '--role',
                'implementer',
                '--data-dir',
                '/dev/null/no-db',
                '--',
                process.execPath,
                '-e',
                'console.log(process.argv[1]); process.exit(37)',
                '--',
                '--role',
            ],
            { cwd, encoding: 'utf8' },
        );
        expect(result.status).toBe(37);
        expect(result.stdout).toBe('--role\n');
        expect(result.stderr).toContain('unrecorded');
    } finally {
        rmSync(cwd, { recursive: true, force: true });
    }
});

it(
    'records dirty checkout trees without changing the index and reuses the current tree',
    { timeout: 30_000 },
    async () => {
        const { execFileSync } = await import('node:child_process');
        const { writeFileSync, readFileSync, mkdirSync } = await import('node:fs');
        const { openWorkRecords } = await import('./work-records.ts');
        const cwd = mkdtempSync(join(tmpdir(), 'check-tree-'));
        const data = mkdtempSync(join(tmpdir(), 'check-data-'));
        const records = await openWorkRecords(join(data, 'work-records.db'));
        try {
            const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
            git('init', '-q');
            writeFileSync(join(cwd, '.gitignore'), 'ignored\n');
            writeFileSync(join(cwd, 'tracked'), 'staged');
            git('add', '.');
            const index = readFileSync(join(cwd, '.git/index'));
            writeFileSync(join(cwd, 'tracked'), 'dirty');
            writeFileSync(join(cwd, 'untracked'), 'new');
            writeFileSync(join(cwd, 'ignored'), 'excluded');
            const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
            const cli = (...args: string[]) =>
                spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
                    cwd,
                    encoding: 'utf8',
                    env: { ...process.env, LAR_FACTORY_DATA_DIR: data },
                });
            expect(
                cli(
                    'run-check',
                    build.workId,
                    '--role',
                    'implementer',
                    '--',
                    process.execPath,
                    '-e',
                    'console.log("ok")',
                ).status,
            ).toBe(0);
            const run = records.checks(build.workId).runs[0]!;
            expect(run.eligible).toBe(true);
            expect(git('show', `${run.tree}:tracked`)).toBe('dirty');
            expect(git('ls-tree', '--name-only', run.tree!)).toBe('.gitignore\ntracked\nuntracked');
            expect(readFileSync(join(cwd, '.git/index'))).toEqual(index);
            expect(readFileSync(join(data, run.log!), 'utf8')).toBe('ok\n');
            expect(
                cli('reuse-check', build.workId, '--check', run.checkId, '--role', 'approver', '--reason', 'same tree')
                    .status,
            ).toBe(0);
            expect(records.checks(build.workId).reuses[0]?.tree).toBe(run.tree);
            mkdirSync(join(data, 'unused'));
            expect(
                cli(
                    'run-check',
                    build.workId,
                    '--role',
                    'implementer',
                    '--',
                    process.execPath,
                    '-e',
                    'require("fs").writeFileSync("tracked", "changed")',
                ).status,
            ).toBe(0);
            expect(records.checks(build.workId).runs[1]?.snapshotState).toBe('changed');
        } finally {
            records.close();
            rmSync(cwd, { recursive: true, force: true });
            rmSync(data, { recursive: true, force: true });
        }
    },
);

it('bounds logs and marks runs outside git ineligible', { timeout: 30_000 }, async () => {
    const { openWorkRecords } = await import('./work-records.ts');
    const { statSync } = await import('node:fs');
    const cwd = mkdtempSync(join(tmpdir(), 'check-log-'));
    const records = await openWorkRecords(join(cwd, 'work-records.db'));
    try {
        const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
        const result = spawnSync(
            process.execPath,
            [
                join(import.meta.dirname, 'cli.ts'),
                'run-check',
                build.workId,
                '--role',
                'implementer',
                '--',
                process.execPath,
                '-e',
                'process.stdout.write("x".repeat(11 * 1024 * 1024))',
            ],
            { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd }, maxBuffer: 12 * 1024 * 1024 },
        );
        expect(result.status).toBe(0);
        const run = records.checks(build.workId).runs[0]!;
        expect(run.snapshotState).toBe('missing');
        expect(run.eligible).toBe(false);
        expect(statSync(join(cwd, run.log!)).size).toBe(10 * 1024 * 1024);
    } finally {
        records.close();
        rmSync(cwd, { recursive: true, force: true });
    }
});

it(
    'waits for a signalled child and records interruption while preserving its exit code',
    { timeout: 30_000 },
    async () => {
        const { spawn } = await import('node:child_process');
        const { openWorkRecords } = await import('./work-records.ts');
        const cwd = mkdtempSync(join(tmpdir(), 'check-signal-'));
        const records = await openWorkRecords(join(cwd, 'work-records.db'));
        const wrappers: ChildProcess[] = [];
        try {
            const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
            const child = spawn(
                process.execPath,
                [
                    join(import.meta.dirname, 'cli.ts'),
                    'run-check',
                    build.workId,
                    '--role',
                    'implementer',
                    '--',
                    process.execPath,
                    '-e',
                    signalledCommand(cwd),
                ],
                { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } },
            );
            wrappers.push(child);
            let output = '';
            child.stderr.resume();
            child.stdout.on('data', (chunk) => {
                output += chunk;
                if (String(chunk).includes('ready')) child.kill('SIGTERM');
            });
            const status = await new Promise((resolve) => child.on('close', resolve));
            expect(status).toBe(23);
            expect(output).toContain('finished');
            expect(records.checks(build.workId).runs[0]?.outcome).toBe('interrupted');
        } finally {
            records.close();
            await stopHelpers({ folders: [cwd], wrappers, gates: [] });
        }
    },
);

it.each([
    ['a command waiting for SIGTERM', signalledCommand],
    ['a command waiting for its gate', gatedCommand],
])('leaves no wrapper or helper running when a test fails before %s ends', { timeout: 30_000 }, async (_, command) => {
    const cwd = mkdtempSync(join(tmpdir(), 'check-failed-'));
    const records = await openWorkRecords(join(cwd, 'work-records.db'));
    const { workId } = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const wrapper = spawn(
        process.execPath,
        [
            join(import.meta.dirname, 'cli.ts'),
            'run-check',
            workId,
            '--role',
            'test',
            '--',
            process.execPath,
            '-e',
            command(cwd),
        ],
        { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd }, stdio: 'ignore' },
    );
    let helper: number;
    try {
        helper = await loggedHelper(cwd);
    } finally {
        records.close();
        await stopHelpers({ folders: [cwd], wrappers: [wrapper], gates: [] });
    }
    expect(wrapper.exitCode !== null || wrapper.signalCode !== null).toBe(true);
    expect(alive(helper)).toBe(false);
    expect(existsSync(cwd)).toBe(false);
});

it(
    'preserves the child status when the log cannot be written or the schema changes at finish',
    { timeout: 30_000 },
    async () => {
        const { writeFileSync } = await import('node:fs');
        const { openWorkRecords } = await import('./work-records.ts');
        const cwd = mkdtempSync(join(tmpdir(), 'check-fallback-'));
        const records = await openWorkRecords(join(cwd, 'work-records.db'));
        try {
            const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
            writeFileSync(join(cwd, 'check-logs'), 'blocked');
            const run = (script: string) =>
                spawnSync(
                    process.execPath,
                    [
                        join(import.meta.dirname, 'cli.ts'),
                        'run-check',
                        build.workId,
                        '--role',
                        'implementer',
                        '--',
                        process.execPath,
                        '-e',
                        script,
                    ],
                    { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } },
                );
            expect(run('process.exit(19)').status).toBe(19);
            expect(records.checks(build.workId).runs[0]?.log).toBeNull();
            const result = run(
                'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync("work-records.db"); db.exec("PRAGMA user_version = 9999"); db.close(); process.exit(29)',
            );
            expect(result.status).toBe(29);
            expect(result.stderr).toContain('unrecorded');
            const newer = run('process.exit(31)');
            expect(newer.status).toBe(31);
            expect(newer.stderr).toContain('unrecorded');
        } finally {
            records.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    },
);

it('runs the child when the database stays busy beyond its timeout', { timeout: 30_000 }, async () => {
    const { DatabaseSync } = await import('node:sqlite');
    const { openWorkRecords } = await import('./work-records.ts');
    const cwd = mkdtempSync(join(tmpdir(), 'check-busy-'));
    const records = await openWorkRecords(join(cwd, 'work-records.db'));
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const lock = new DatabaseSync(join(cwd, 'work-records.db'));
    try {
        lock.exec('BEGIN IMMEDIATE');
        const result = spawnSync(
            process.execPath,
            [
                join(import.meta.dirname, 'cli.ts'),
                'run-check',
                build.workId,
                '--role',
                'implementer',
                '--',
                process.execPath,
                '-e',
                'console.log("ran"); process.exit(17)',
            ],
            { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } },
        );
        expect(result.status).toBe(17);
        expect(result.stdout).toBe('ran\n');
        expect(result.stderr).toContain('unrecorded');
    } finally {
        lock.exec('ROLLBACK');
        lock.close();
        records.close();
        rmSync(cwd, { recursive: true, force: true });
    }
});

it('retains a signal received while opening the record until the command starts', { timeout: 30_000 }, async () => {
    const { openWorkRecords } = await import('./work-records.ts');
    const cwd = mkdtempSync(join(tmpdir(), 'check-early-signal-'));
    const records = await openWorkRecords(join(cwd, 'work-records.db'));
    try {
        const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
        const script = `import { checkCommand } from ${JSON.stringify(join(import.meta.dirname, 'check-runner.ts'))}; const result = checkCommand(['run-check', ${JSON.stringify(build.workId)}, '--role', 'test', '--', process.execPath, '-e', ${JSON.stringify(`${helperStart(cwd)} setInterval(() => {}, 1000)`)}]); process.emit('SIGTERM'); process.exitCode = await result;`;
        const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
            cwd,
            encoding: 'utf8',
            timeout: 10_000,
            env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(143);
        expect(records.checks(build.workId).runs[0]?.outcome).toBe('interrupted');
    } finally {
        records.close();
        await stopHelpers({ folders: [cwd], wrappers: [], gates: [] });
    }
});

it('preserves output and the log when the consumer drains output slowly', { timeout: 30_000 }, async () => {
    const { spawn } = await import('node:child_process');
    const { readFileSync } = await import('node:fs');
    const { openWorkRecords } = await import('./work-records.ts');
    const cwd = mkdtempSync(join(tmpdir(), 'check-pressure-'));
    const records = await openWorkRecords(join(cwd, 'work-records.db'));
    try {
        const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
        const child = spawn(
            process.execPath,
            [
                join(import.meta.dirname, 'cli.ts'),
                'run-check',
                build.workId,
                '--role',
                'test',
                '--',
                process.execPath,
                '-e',
                'process.stdout.write("x".repeat(4 * 1024 * 1024)); process.exitCode = 21',
            ],
            { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } },
        );
        const chunks: Buffer[] = [];
        child.stderr.resume();
        child.stdout.on('data', (chunk) => {
            chunks.push(chunk);
            child.stdout.pause();
            setTimeout(() => child.stdout.resume(), 5);
        });
        expect(await new Promise((resolve) => child.on('close', resolve))).toBe(21);
        const expected = Buffer.alloc(4 * 1024 * 1024, 'x');
        expect(Buffer.concat(chunks).equals(expected)).toBe(true);
        expect(readFileSync(join(cwd, records.checks(build.workId).runs[0]!.log!)).equals(expected)).toBe(true);
    } finally {
        records.close();
        rmSync(cwd, { recursive: true, force: true });
    }
});

it('preserves the command status when the database becomes busy at finish', { timeout: 30_000 }, async () => {
    const { spawn } = await import('node:child_process');
    const { writeFileSync } = await import('node:fs');
    const { DatabaseSync } = await import('node:sqlite');
    const { openWorkRecords } = await import('./work-records.ts');
    const cwd = mkdtempSync(join(tmpdir(), 'check-finish-busy-'));
    const records = await openWorkRecords(join(cwd, 'work-records.db'));
    const lock = new DatabaseSync(join(cwd, 'work-records.db'));
    const wrappers: ChildProcess[] = [];
    try {
        const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
        const child = spawn(
            process.execPath,
            [
                join(import.meta.dirname, 'cli.ts'),
                'run-check',
                build.workId,
                '--role',
                'test',
                '--',
                process.execPath,
                '-e',
                gatedCommand(cwd),
            ],
            { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } },
        );
        wrappers.push(child);
        let stderr = '';
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.stdout.once('data', () => {
            lock.exec('BEGIN IMMEDIATE');
            writeFileSync(join(cwd, 'go'), '');
        });
        expect(await new Promise((resolve) => child.on('close', resolve))).toBe(27);
        expect(stderr).toContain('unrecorded');
        lock.exec('ROLLBACK');
        expect(records.checks(build.workId).runs[0]?.outcome).toBe('unfinished');
    } finally {
        lock.close();
        records.close();
        await stopHelpers({ folders: [cwd], wrappers, gates: [join(cwd, 'go')] });
    }
});

it(
    'preserves the command status when its record table becomes unavailable at finish',
    { timeout: 30_000 },
    async () => {
        const { openWorkRecords } = await import('./work-records.ts');
        const cwd = mkdtempSync(join(tmpdir(), 'check-finish-unavailable-'));
        const records = await openWorkRecords(join(cwd, 'work-records.db'));
        try {
            const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
            const result = spawnSync(
                process.execPath,
                [
                    join(import.meta.dirname, 'cli.ts'),
                    'run-check',
                    build.workId,
                    '--role',
                    'test',
                    '--',
                    process.execPath,
                    '-e',
                    'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync("work-records.db"); db.exec("DROP TABLE check_runs"); db.close(); process.exit(33)',
                ],
                { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } },
            );
            expect(result.status).toBe(33);
            expect(result.stderr).toContain('unrecorded');
        } finally {
            records.close();
            rmSync(cwd, { recursive: true, force: true });
        }
    },
);

describe('run-check waiting for a heavy command slot', () => {
    // One slot, held by a heavy command that ends once the gate file exists, and a run-check that waits for it.
    async function waiting(
        test: (wait: {
            child: ChildProcess;
            status: Promise<number | null>;
            records: Awaited<ReturnType<typeof openWorkRecords>>;
            workId: string;
            ran: string;
            gate: string;
            cwd: string;
        }) => Promise<void>,
    ) {
        const cwd = mkdtempSync(join(tmpdir(), 'check-slot-'));
        const gate = join(cwd, 'gate'),
            ran = join(cwd, 'ran');
        const env = { ...process.env, LAR_FACTORY_DATA_DIR: cwd, LAR_WORK_HEAVY_CHECK_MS: '50' };
        writeHeavyCommandLimit(1, cwd);
        const records = await openWorkRecords(join(cwd, 'work-records.db'));
        const holder = spawn(
            process.execPath,
            [
                join(import.meta.dirname, 'cli.ts'),
                'heavy',
                '--',
                process.execPath,
                '-e',
                `${helperStart(cwd)} console.log("held"); setInterval(() => { if (require("fs").existsSync(${JSON.stringify(gate)})) process.exit(0); }, 20)`,
            ],
            { cwd, env },
        );
        holder.stderr.resume();
        let child: ChildProcess | undefined;
        try {
            await once(holder.stdout, 'data');
            const { workId } = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
            child = spawn(
                process.execPath,
                [
                    join(import.meta.dirname, 'cli.ts'),
                    'run-check',
                    workId,
                    '--role',
                    'test',
                    '--',
                    process.execPath,
                    '-e',
                    `require("fs").writeFileSync(${JSON.stringify(ran)}, "")`,
                ],
                { cwd, env },
            );
            child.stdout!.resume();
            const status = once(child, 'close').then(([code]) => code as number | null);
            let stderr = '';
            child.stderr!.on('data', (chunk) => {
                stderr += chunk;
            });
            for (const deadline = Date.now() + 15_000; !stderr.includes('waiting for a heavy command slot');) {
                if (Date.now() > deadline) throw Error(`run-check never waited: ${stderr}`);
                await new Promise((done) => setTimeout(done, 20));
            }
            await test({ child, status, records, workId, ran, gate, cwd });
        } finally {
            records.close();
            await stopHelpers({ folders: [cwd], wrappers: child ? [child, holder] : [holder], gates: [gate] });
        }
    }

    it(
        'leaves no wrapper or helper running when a test fails before its holder ends',
        { timeout: 30_000 },
        async () => {
            let helper = 0;
            let folder = '';
            await expect(
                waiting(async ({ cwd }) => {
                    folder = cwd;
                    helper = await loggedHelper(cwd);
                    throw Error('The test failed.');
                }),
            ).rejects.toThrow('The test failed.');
            expect(alive(helper)).toBe(false);
            expect(existsSync(folder)).toBe(false);
        },
    );

    it(
        'records the row without tree or start time while waiting, then both once the slot is held',
        { timeout: 30_000 },
        () =>
            waiting(async ({ status, records, workId, gate }) => {
                const waited = records.checks(workId).runs[0]!;
                expect(waited).toMatchObject({ tree: null, startedAt: null, outcome: 'unfinished' });
                const released = new Date().toISOString();
                writeFileSync(gate, '');
                expect(await status).toBe(0);
                const run = records.checks(workId).runs[0]!;
                expect(run.outcome).toBe('passed');
                expect(run.startedAt! >= released).toBe(true);
            }),
    );

    it(
        'records an interrupted outcome without starting the command when signalled during the wait',
        { timeout: 30_000 },
        () =>
            waiting(async ({ child, status, records, workId, ran }) => {
                child.kill('SIGTERM');
                expect(await status).toBe(143);
                expect(records.checks(workId).runs[0]).toMatchObject({
                    outcome: 'interrupted',
                    startedAt: null,
                    exitStatus: null,
                });
                expect(existsSync(ran)).toBe(false);
            }),
    );

    it('reads as not finished when hard-killed during the wait', { timeout: 30_000 }, () =>
        waiting(async ({ child, status, records, workId, ran }) => {
            child.kill('SIGKILL');
            await status;
            expect(records.checks(workId).runs[0]).toMatchObject({
                outcome: 'unfinished',
                snapshotState: 'unfinished',
                tree: null,
                startedAt: null,
            });
            expect(existsSync(ran)).toBe(false);
        }),
    );
});
