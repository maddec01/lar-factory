import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it, expect } from 'vite-plus/test';
it('passes child arguments and status through even without a database', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'check-runner-'));
  try {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', 'missing', '--role', 'implementer', '--data-dir', '/dev/null/no-db', '--', process.execPath, '-e', 'console.log(process.argv[1]); process.exit(37)', '--', '--role'], { cwd, encoding: 'utf8' });
    expect(result.status).toBe(37);
    expect(result.stdout).toBe('--role\n');
    expect(result.stderr).toContain('unrecorded');
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

it('records dirty checkout trees without changing the index and reuses the current tree', { timeout: 30_000 }, async () => {
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
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: data } });
    expect(cli('run-check', build.workId, '--role', 'implementer', '--', process.execPath, '-e', 'console.log("ok")').status).toBe(0);
    const run = records.checks(build.workId).runs[0]!;
    expect(run.eligible).toBe(true);
    expect(git('show', `${run.tree}:tracked`)).toBe('dirty');
    expect(git('ls-tree', '--name-only', run.tree!)).toBe('.gitignore\ntracked\nuntracked');
    expect(readFileSync(join(cwd, '.git/index'))).toEqual(index);
    expect(readFileSync(join(data, run.log!), 'utf8')).toBe('ok\n');
    expect(cli('reuse-check', build.workId, '--check', run.checkId, '--role', 'approver', '--reason', 'same tree').status).toBe(0);
    expect(records.checks(build.workId).reuses[0]?.tree).toBe(run.tree);
    mkdirSync(join(data, 'unused'));
    expect(cli('run-check', build.workId, '--role', 'implementer', '--', process.execPath, '-e', 'require("fs").writeFileSync("tracked", "changed")').status).toBe(0);
    expect(records.checks(build.workId).runs[1]?.snapshotState).toBe('changed');
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); rmSync(data, { recursive: true, force: true }); }
});

it('bounds logs and marks runs outside git ineligible', { timeout: 30_000 }, async () => {
  const { openWorkRecords } = await import('./work-records.ts');
  const { statSync } = await import('node:fs');
  const cwd = mkdtempSync(join(tmpdir(), 'check-log-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'implementer', '--', process.execPath, '-e', 'process.stdout.write("x".repeat(11 * 1024 * 1024))'], { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd }, maxBuffer: 12 * 1024 * 1024 });
    expect(result.status).toBe(0);
    const run = records.checks(build.workId).runs[0]!;
    expect(run.snapshotState).toBe('missing');
    expect(run.eligible).toBe(false);
    expect(statSync(join(cwd, run.log!)).size).toBe(10 * 1024 * 1024);
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('waits for a signalled child and records interruption while preserving its exit code', { timeout: 30_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-signal-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const child = spawn(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'implementer', '--', process.execPath, '-e', 'process.on("SIGTERM", () => setTimeout(() => { console.log("finished"); process.exit(23); }, 100)); console.log("ready"); setInterval(() => {}, 1000)'], { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    let output = '';
    child.stderr.resume();
    child.stdout.on('data', chunk => { output += chunk; if (String(chunk).includes('ready')) child.kill('SIGTERM'); });
    const status = await new Promise(resolve => child.on('close', resolve));
    expect(status).toBe(23);
    expect(output).toContain('finished');
    expect(records.checks(build.workId).runs[0]?.outcome).toBe('interrupted');
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('preserves the child status when the log cannot be written or the schema changes at finish', { timeout: 30_000 }, async () => {
  const { writeFileSync } = await import('node:fs');
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-fallback-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    writeFileSync(join(cwd, 'check-logs'), 'blocked');
    const run = (script: string) => spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'implementer', '--', process.execPath, '-e', script], { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    expect(run('process.exit(19)').status).toBe(19);
    expect(records.checks(build.workId).runs[0]?.log).toBeNull();
    const result = run('const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync("work-records.db"); db.exec("PRAGMA user_version = 9999"); db.close(); process.exit(29)');
    expect(result.status).toBe(29);
    expect(result.stderr).toContain('unrecorded');
    const newer = run('process.exit(31)');
    expect(newer.status).toBe(31);
    expect(newer.stderr).toContain('unrecorded');
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('runs the child when the database stays busy beyond its timeout', { timeout: 30_000 }, async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-busy-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
  const lock = new DatabaseSync(join(cwd, 'work-records.db'));
  try {
    lock.exec('BEGIN IMMEDIATE');
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'implementer', '--', process.execPath, '-e', 'console.log("ran"); process.exit(17)'], { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    expect(result.status).toBe(17);
    expect(result.stdout).toBe('ran\n');
    expect(result.stderr).toContain('unrecorded');
  } finally { lock.exec('ROLLBACK'); lock.close(); records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('retains a signal received while opening the record until the command starts', { timeout: 30_000 }, async () => {
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-early-signal-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const script = `import { checkCommand } from ${JSON.stringify(join(import.meta.dirname, 'check-runner.ts'))}; const result = checkCommand(['run-check', ${JSON.stringify(build.workId)}, '--role', 'test', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)']); process.emit('SIGTERM'); process.exitCode = await result;`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8', timeout: 10_000, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(143);
    expect(records.checks(build.workId).runs[0]?.outcome).toBe('interrupted');
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('preserves output and the log when the consumer drains output slowly', { timeout: 30_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-pressure-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const child = spawn(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'test', '--', process.execPath, '-e', 'process.stdout.write("x".repeat(4 * 1024 * 1024)); process.exitCode = 21'], { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    const chunks: Buffer[] = [];
    child.stderr.resume();
    child.stdout.on('data', chunk => { chunks.push(chunk); child.stdout.pause(); setTimeout(() => child.stdout.resume(), 5); });
    expect(await new Promise(resolve => child.on('close', resolve))).toBe(21);
    const expected = Buffer.alloc(4 * 1024 * 1024, 'x');
    expect(Buffer.concat(chunks).equals(expected)).toBe(true);
    expect(readFileSync(join(cwd, records.checks(build.workId).runs[0]!.log!)).equals(expected)).toBe(true);
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('preserves the command status when the database becomes busy at finish', { timeout: 30_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const { DatabaseSync } = await import('node:sqlite');
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-finish-busy-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  const lock = new DatabaseSync(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const child = spawn(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'test', '--', process.execPath, '-e', 'console.log("ready"); process.stdin.resume(); process.stdin.on("end", () => process.exit(27))'], { cwd, env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.once('data', () => { lock.exec('BEGIN IMMEDIATE'); child.stdin.end(); });
    expect(await new Promise(resolve => child.on('close', resolve))).toBe(27);
    expect(stderr).toContain('unrecorded');
    lock.exec('ROLLBACK');
    expect(records.checks(build.workId).runs[0]?.outcome).toBe('unfinished');
  } finally { lock.close(); records.close(); rmSync(cwd, { recursive: true, force: true }); }
});

it('preserves the command status when its record table becomes unavailable at finish', { timeout: 30_000 }, async () => {
  const { openWorkRecords } = await import('./work-records.ts');
  const cwd = mkdtempSync(join(tmpdir(), 'check-finish-unavailable-'));
  const records = await openWorkRecords(join(cwd, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), 'run-check', build.workId, '--role', 'test', '--', process.execPath, '-e', 'const { DatabaseSync } = require("node:sqlite"); const db = new DatabaseSync("work-records.db"); db.exec("DROP TABLE check_runs"); db.close(); process.exit(33)'], { cwd, encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: cwd } });
    expect(result.status).toBe(33);
    expect(result.stderr).toContain('unrecorded');
  } finally { records.close(); rmSync(cwd, { recursive: true, force: true }); }
});
