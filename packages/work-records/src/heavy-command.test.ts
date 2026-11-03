import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { writeHeavyCommandLimit } from './heavy-command-limit.ts';

const cli = join(import.meta.dirname, 'cli.ts');
const folders: string[] = [];
const children: ChildProcess[] = [];
const gates: string[] = [];
afterEach(async () => {
  for (const gate of gates.splice(0)) writeFileSync(gate, '');
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) await once(child, 'close');
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});
const temp = (name: string) => { const folder = mkdtempSync(join(tmpdir(), `heavy-${name}-`)); folders.push(folder); return folder; };

// A fake heavy command: it logs its start, then ends after a number of milliseconds or once its gate file exists.
const JOB = `import { appendFileSync, existsSync } from 'node:fs';
const [log, name, until] = process.argv.slice(2);
appendFileSync(log, \`start \${name} \${process.pid} \${process.cwd()}\\n\`);
const end = () => { appendFileSync(log, \`end \${name}\\n\`); process.exit(0); };
if (until.startsWith('ms:')) setTimeout(end, Number(until.slice(3)));
else setInterval(() => { if (existsSync(until)) end(); }, 20);
`;

interface Wrapper { child: ChildProcess; stderr: () => string; status: Promise<number | null> }
function setup(limit: number) {
  const root = temp('run');
  const data = join(root, 'data');
  writeHeavyCommandLimit(limit, data);
  const log = join(root, 'log');
  writeFileSync(log, '');
  const job = join(root, 'job.mjs');
  writeFileSync(job, JOB);
  const heavy = (command: string[], { cwd = root, dataDir = data, checkMs = 50 } = {}): Wrapper => {
    const child = spawn(process.execPath, [cli, 'heavy', '--data-dir', dataDir, '--', ...command], { cwd, env: { ...process.env, LAR_WORK_HEAVY_CHECK_MS: String(checkMs) }, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stderr = '';
    child.stdout!.resume();
    child.stderr!.on('data', chunk => { stderr += chunk; });
    return { child, stderr: () => stderr, status: once(child, 'close').then(([code]) => code as number | null) };
  };
  const gate = (name: string) => { const path = join(root, `${name}.gate`); gates.push(path); return path; };
  return {
    data, log, heavy, gate,
    job: (name: string, until: string, cwd?: string) => heavy([process.execPath, job, log, name, until], { cwd }),
    lines: () => readFileSync(log, 'utf8').split('\n').filter(Boolean),
    started: (name: string) => readFileSync(log, 'utf8').split('\n').find(line => line.startsWith(`start ${name} `)),
  };
}
async function until(condition: () => unknown, ms = 15_000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw Error('Timed out waiting.');
    await new Promise(done => setTimeout(done, 20));
  }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidOf = (line: string | undefined) => Number(line!.split(' ')[2]);
const DEAD_OWNER = { pid: process.pid, token: '12345678-1234-1234-1234-123456789abc', identity: 'previous-process', folder: '/', command: ['old'] };

describe('lar-work heavy', () => {
  it('runs no more commands at once than the limit across folders and worktrees, and every waiter runs', { timeout: 60_000 }, async () => {
    const run = setup(2);
    const repo = temp('repo');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '-q');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = join(temp('worktrees'), 'other');
    git('worktree', 'add', '-q', worktree);
    const wrappers = [0, 1, 2, 3, 4, 5].map(i => run.job(`job${i}`, 'ms:250', i % 2 ? worktree : repo));
    expect(await Promise.all(wrappers.map(wrapper => wrapper.status))).toEqual([0, 0, 0, 0, 0, 0]);
    let running = 0;
    let most = 0;
    for (const line of run.lines()) { running += line.startsWith('start ') ? 1 : -1; most = Math.max(most, running); }
    expect(most).toBe(2);
    const starts = run.lines().filter(line => line.startsWith('start '));
    expect(starts).toHaveLength(6);
    expect(new Set(starts.map(line => line.split(' ')[3]))).toEqual(new Set([execFileSync('pwd', ['-P'], { cwd: repo, encoding: 'utf8' }).trim(), execFileSync('pwd', ['-P'], { cwd: worktree, encoding: 'utf8' }).trim()]));
    expect(wrappers.some(wrapper => wrapper.stderr().includes('waiting for a heavy command slot'))).toBe(true);
    expect(wrappers.every(wrapper => /started after waiting \d+s/.test(wrapper.stderr()))).toBe(true);
  });

  it('starts nothing new after a lowered limit until the running count is below it', { timeout: 30_000 }, async () => {
    const run = setup(2);
    const [a, b, c] = [run.gate('a'), run.gate('b'), run.gate('c')];
    const first = run.job('a', a);
    const second = run.job('b', b);
    await until(() => run.started('a') && run.started('b'));
    writeHeavyCommandLimit(1, run.data);
    const third = run.job('c', c);
    writeFileSync(a, '');
    expect(await first.status).toBe(0);
    await new Promise(done => setTimeout(done, 500));
    expect(run.started('c')).toBeUndefined();
    writeFileSync(b, '');
    expect(await second.status).toBe(0);
    await until(() => run.started('c'));
    writeFileSync(c, '');
    expect(await third.status).toBe(0);
  });

  it('reuses the slot of a force-killed wrapper', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const killed = run.job('a', run.gate('a'));
    await until(() => run.started('a'));
    killed.child.kill('SIGKILL');
    // Its command outlives it and keeps the pipes open, so it never closes until the gate opens.
    await once(killed.child, 'exit');
    expect(await run.job('b', 'ms:0').status).toBe(0);
  });

  it('frees a slot whose owner process ID now belongs to another process', { timeout: 30_000 }, async () => {
    const run = setup(1);
    mkdirSync(join(run.data, 'heavy-slots'));
    writeFileSync(join(run.data, 'heavy-slots', 'slot-0'), JSON.stringify(DEAD_OWNER));
    const next = run.job('b', 'ms:0');
    expect(await next.status).toBe(0);
    expect(next.stderr()).not.toContain('waiting for');
  });

  it('stops the command when cancelled and frees its slot', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const cancelled = run.job('a', run.gate('a'));
    await until(() => run.started('a'));
    cancelled.child.kill('SIGTERM');
    expect(await cancelled.status).toBe(143);
    expect(alive(pidOf(run.started('a')))).toBe(false);
    expect(await run.job('b', 'ms:0').status).toBe(0);
  });

  it('kills a command group still running after the grace period', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const stubborn = run.heavy([process.execPath, '-e', `process.on('SIGTERM', () => {}); require('fs').appendFileSync(${JSON.stringify(run.log)}, 'start a ' + process.pid + '\\n'); setInterval(() => {}, 1000)`]);
    await until(() => run.started('a'));
    stubborn.child.kill('SIGTERM');
    expect(await stubborn.status).toBe(137);
    expect(alive(pidOf(run.started('a')))).toBe(false);
  });

  it('kills a group member that outlives its leader after the grace period, then frees the slot', { timeout: 30_000 }, async () => {
    const run = setup(1);
    // The leader ends on SIGTERM; the member it starts in the same group ignores it and holds none of the wrapper's pipes.
    const script = join(dirname(run.log), 'group.cjs');
    writeFileSync(script, `const { spawn } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const [log, role] = process.argv.slice(2);
if (role === 'member') process.on('SIGTERM', () => {});
else spawn(process.execPath, [__filename, log, 'member'], { stdio: 'ignore' });
appendFileSync(log, \`start \${role} \${process.pid}\\n\`);
setInterval(() => {}, 1000);
`);
    const wrapper = run.heavy([process.execPath, script, run.log, 'leader']);
    await until(() => run.started('leader') && run.started('member'));
    const member = pidOf(run.started('member'));
    try {
      wrapper.child.kill('SIGTERM');
      expect(await wrapper.status).toBe(143);
      expect(alive(member)).toBe(false);
      expect(existsSync(join(run.data, 'heavy-slots', 'slot-0'))).toBe(false);
    } finally { if (alive(member)) process.kill(member, 'SIGKILL'); }
  });

  it('skips unreadable slot files and still limits the commands that run', { timeout: 30_000 }, async () => {
    const run = setup(1);
    mkdirSync(join(run.data, 'heavy-slots'));
    writeFileSync(join(run.data, 'heavy-slots', 'slot-0'), 'not an owner');
    writeFileSync(join(run.data, 'heavy-slots', 'slot-1'), JSON.stringify({ pid: process.pid, token: DEAD_OWNER.token, folder: 1, command: 'old' }));
    const a = run.gate('a');
    const first = run.job('a', a);
    await until(() => run.started('a'));
    const second = run.job('b', 'ms:0');
    await until(() => second.stderr().includes('waiting for a heavy command slot'));
    expect(run.started('b')).toBeUndefined();
    writeFileSync(a, '');
    expect(await first.status).toBe(0);
    expect(await second.status).toBe(0);
    for (const wrapper of [first, second]) expect(wrapper.stderr()).not.toContain('Running without a slot');
    expect(first.stderr()).toContain('ignoring unreadable heavy command slot');
  });

  it('removes the owner files of waiters that died before claiming a slot', { timeout: 30_000 }, async () => {
    const run = setup(1);
    mkdirSync(join(run.data, 'heavy-slots'));
    const exited = spawn(process.execPath, ['-e', '']);
    await once(exited, 'exit');
    const leftover = join(run.data, 'heavy-slots', `slot.owner.${exited.pid}.${DEAD_OWNER.token}`);
    writeFileSync(leftover, JSON.stringify({ ...DEAD_OWNER, pid: exited.pid }));
    expect(await run.job('a', 'ms:0').status).toBe(0);
    expect(existsSync(leftover)).toBe(false);
  });

  it('exits at once when cancelled between checks', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const holder = run.job('a', run.gate('a'));
    await until(() => run.started('a'));
    const waiter = run.heavy([process.execPath, '-e', ''], { checkMs: 20_000 });
    await until(() => waiter.stderr().includes('waiting'));
    const cancelled = Date.now();
    waiter.child.kill('SIGTERM');
    expect(await waiter.status).toBe(143);
    expect(Date.now() - cancelled).toBeLessThan(5000);
    expect(holder.child.exitCode).toBeNull();
  });

  it('exits without starting the command when cancelled while waiting, after naming the holders', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const holder = run.job('a', run.gate('a'));
    await until(() => run.started('a'));
    const waiter = run.job('b', 'ms:0');
    await until(() => waiter.stderr().includes('waiting'));
    expect(waiter.stderr()).toContain(`process ${holder.child.pid} in `);
    waiter.child.kill('SIGTERM');
    expect(await waiter.status).toBe(143);
    expect(run.started('b')).toBeUndefined();
  });

  it('runs a nested heavy command in the same data folder without a second slot', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const nested = run.heavy([process.execPath, cli, 'heavy', '--data-dir', run.data, '--', process.execPath, '-e', 'process.exit(5)']);
    expect(await nested.status).toBe(5);
  });

  it('runs the command after a warning when the slot folder is unusable', { timeout: 30_000 }, async () => {
    const run = setup(1);
    const file = join(run.data, 'not-a-folder');
    writeFileSync(file, '');
    const wrapper = run.heavy([process.execPath, '-e', 'process.exit(37)'], { dataDir: file });
    expect(await wrapper.status).toBe(37);
    expect(wrapper.stderr()).toContain('Running without a slot');
  });

  it.each([
    ['no command', [], 2],
    ['a missing command', ['lar-work-no-such-command'], 127],
    ['a command that is not executable', ['NOT_EXECUTABLE'], 126],
    ['a command killed by a signal', [process.execPath, '-e', 'process.kill(process.pid, "SIGTERM")'], 143],
  ])('exits with the right status for %s', { timeout: 30_000 }, async (_, command, status) => {
    const run = setup(1);
    const plain = join(run.data, 'plain');
    writeFileSync(plain, '');
    chmodSync(plain, 0o644);
    const wrapper = run.heavy(command.map(word => word === 'NOT_EXECUTABLE' ? plain : word));
    expect(await wrapper.status).toBe(status);
    expect(existsSync(join(run.data, 'heavy-slots', 'slot-0')) && readFileSync(join(run.data, 'heavy-slots', 'slot-0'), 'utf8')).toBeFalsy();
  });
});
