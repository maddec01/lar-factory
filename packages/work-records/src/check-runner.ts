import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, constants } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Readable } from 'node:stream';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

function snapshot(): { tree: string | null; folder: string } {
  let temp: string | undefined;
  try {
    const checkoutEnv = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete checkoutEnv[key];
    const git = (args: string[], env = checkoutEnv) => execFileSync('git', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const root = git(['rev-parse', '--show-toplevel']);
    const index = git(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    temp = mkdtempSync(join(tmpdir(), 'lar-check-index-'));
    const target = join(temp, 'index');
    if (existsSync(index)) copyFileSync(index, target);
    const env = { ...checkoutEnv, GIT_INDEX_FILE: target };
    git(['-C', root, 'add', '-A'], env);
    return { tree: git(['write-tree'], env), folder: relative(root, process.cwd()) || '.' };
  } catch { return { tree: null, folder: '.' }; }
  finally { if (temp) rmSync(temp, { recursive: true, force: true }); }
}

export async function checkCommand(args: string[]): Promise<number> {
  const reuse = args[0] === 'reuse-check';
  const separator = args.indexOf('--');
  let parsed;
  try {
    parsed = parseArgs({ args: args.slice(1, separator < 0 ? undefined : separator), allowPositionals: true, options: { role: { type: 'string' }, reason: { type: 'string' }, live: { type: 'boolean' }, check: { type: 'string' }, 'data-dir': { type: 'string' } } });
    if (parsed.positionals.length !== 1 || !parsed.values.role?.trim() || (!reuse && (separator < 0 || !args[separator + 1])) || (reuse && (!parsed.values.check || !parsed.values.reason?.trim()))) throw new Error('Expected work ID, role and command, or check ID and reuse reason.');
  } catch (error) { process.stderr.write(`lar-work: ${String(error)}\n`); return 2; }
  const { values, positionals: [workId] } = parsed;
  const command = args.slice(separator + 1);
  let interrupted = false;
  let pendingSignal: NodeJS.Signals | undefined;
  let child: ChildProcess | undefined;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
  const forward = (signal: NodeJS.Signals) => {
    interrupted = true;
    pendingSignal = signal;
    if (!child) return;
    try {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch { /* Child already exited. */ }
  };
  const handlers = reuse ? [] : signals.map(signal => {
    const handler = () => forward(signal);
    process.on(signal, handler);
    return handler;
  });
  const start = snapshot();
  let records: WorkRecords | undefined;
  let run: ReturnType<WorkRecords['startCheck']> | undefined;
  const warn = (error: unknown) => process.stderr.write(`lar-work: check may be unrecorded: ${String(error)}\n`);
  try {
    records = await openWorkRecords(workRecordsPath(values['data-dir']));
    if (reuse) {
      if (!start.tree) throw new Error('Current tree unavailable.');
      process.stdout.write(`${JSON.stringify(records.reuseCheck(workId!, values.check!, { role: values.role!, reason: values.reason!, tree: start.tree }))}\n`);
      records.close();
      return 0;
    }
    run = records.startCheck(workId!, { ...start, command, role: values.role!, reason: values.reason, live: values.live });
    process.stderr.write(`lar-work: check ${run.checkId}\n`);
  } catch (error) { if (reuse) { records?.close(); process.stderr.write(`lar-work: ${String(error)}\n`); return 1; } warn(error); }
  child = spawn(command[0]!, command.slice(1), { stdio: ['inherit', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
  if (pendingSignal) forward(pendingSignal);
  const capacity = 10 * 1024 * 1024;
  const tail = Buffer.allocUnsafe(capacity);
  let cursor = 0;
  let retained = 0;
  const capture = (chunk: Buffer, output: NodeJS.WriteStream, input: Readable) => {
    if (!output.write(chunk)) { input.pause(); output.once('drain', () => input.resume()); }
    const bytes = chunk.length > capacity ? chunk.subarray(-capacity) : chunk;
    const first = Math.min(bytes.length, capacity - cursor);
    bytes.copy(tail, cursor, 0, first);
    bytes.copy(tail, 0, first);
    cursor = (cursor + bytes.length) % capacity;
    retained = Math.min(capacity, retained + bytes.length);
  };
  const running = child;
  running.stdout!.on('data', chunk => capture(chunk, process.stdout, running.stdout!));
  running.stderr!.on('data', chunk => capture(chunk, process.stderr, running.stderr!));
  const outcome = await new Promise<{ code: number; signal: NodeJS.Signals | null }>(resolve => {
    running.on('error', error => { process.stderr.write(`lar-work: ${error.message}\n`); });
    running.on('close', (code, signal) => resolve({ code: code ?? (signal ? 128 + constants.signals[signal] : 127), signal }));
  });
  const end = snapshot();
  let log: string | null = null;
  if (run) {
    try { log = `check-logs/${run.workId}/${run.checkId}.log`; const path = join(dirname(workRecordsPath(values['data-dir'])), log); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, retained < capacity ? tail.subarray(0, retained) : Buffer.concat([tail.subarray(cursor), tail.subarray(0, cursor)])); } catch { log = null; }
    try { records!.finishCheck(run.checkId, { tree: end.tree, exitStatus: outcome.code, interrupted: interrupted || outcome.signal !== null, log }); } catch (error) { warn(error); }
  }
  signals.forEach((signal, i) => process.removeListener(signal, handlers[i]!));
  try { records?.close(); } catch (error) { warn(error); }
  return outcome.code;
}
