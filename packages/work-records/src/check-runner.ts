import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { Readable } from 'node:stream';
import { waitForHeavySlot } from './heavy-command.ts';
import { signalStatus, trapTermination } from './process-group.ts';
import type { CheckRun } from './validation-records.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const checkoutEnv = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return env;
};
const git = (args: string[], env = checkoutEnv()) => execFileSync('git', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The current folder relative to its checkout's root, or '.' outside a checkout. */
function checkoutFolder(): string {
  try { return relative(git(['rev-parse', '--show-toplevel']), process.cwd()) || '.'; } catch { return '.'; }
}

/** The checkout's tree as it stands, including unstaged and untracked files, without changing its index. */
function snapshot(): string | null {
  let temp: string | undefined;
  try {
    const root = git(['rev-parse', '--show-toplevel']);
    const index = git(['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    temp = mkdtempSync(join(tmpdir(), 'lar-check-index-'));
    const target = join(temp, 'index');
    if (existsSync(index)) copyFileSync(index, target);
    const env = { ...checkoutEnv(), GIT_INDEX_FILE: target };
    git(['-C', root, 'add', '-A'], env);
    return git(['write-tree'], env);
  } catch { return null; }
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
  const path = workRecordsPath(values['data-dir']);
  if (reuse) {
    let records: WorkRecords | undefined;
    try {
      const tree = snapshot();
      if (!tree) throw new Error('Current tree unavailable.');
      records = await openWorkRecords(path);
      process.stdout.write(`${JSON.stringify(records.reuseCheck(workId!, values.check!, { role: values.role!, reason: values.reason!, tree }))}\n`);
      return 0;
    } catch (error) { process.stderr.write(`lar-work: ${String(error)}\n`); return 1; }
    finally { records?.close(); }
  }
  const command = args.slice(separator + 1);
  const termination = trapTermination();
  let records: WorkRecords | undefined;
  let run: CheckRun | undefined;
  const warn = (error: unknown) => process.stderr.write(`lar-work: check may be unrecorded: ${String(error)}\n`);
  const record = (write: (records: WorkRecords, run: CheckRun) => void) => { if (run) try { write(records!, run); } catch (error) { warn(error); } };
  try {
    try {
      records = await openWorkRecords(path);
      run = records.waitCheck(workId!, { folder: checkoutFolder(), command, role: values.role!, reason: values.reason, live: values.live });
      process.stderr.write(`lar-work: check ${run.checkId}\n`);
    } catch (error) { warn(error); }
    const slot = await waitForHeavySlot(dirname(path), command, termination.signalled);
    if (!slot) {
      record((records, run) => records.finishCheck(run.checkId, { tree: null, exitStatus: null, interrupted: true, log: null }));
      return signalStatus(termination.signal!);
    }
    try {
      record((records, run) => records.beginCheck(run.checkId, { tree: snapshot() }));
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
      const outcome = await termination.run(command, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: slot.env,
        started: child => {
          child.stdout!.on('data', chunk => capture(chunk, process.stdout, child.stdout!));
          child.stderr!.on('data', chunk => capture(chunk, process.stderr, child.stderr!));
        },
      });
      const end = snapshot();
      record((records, run) => {
        let log: string | null = `check-logs/${run.workId}/${run.checkId}.log`;
        try { const file = join(dirname(path), log); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, retained < capacity ? tail.subarray(0, retained) : Buffer.concat([tail.subarray(cursor), tail.subarray(0, cursor)])); } catch { log = null; }
        records.finishCheck(run.checkId, { tree: end, exitStatus: outcome.code, interrupted: termination.signal !== undefined || outcome.signal !== null, log });
      });
      return outcome.code;
    } finally { await slot.release(); }
  } finally {
    termination.dispose();
    try { records?.close(); } catch (error) { warn(error); }
  }
}
