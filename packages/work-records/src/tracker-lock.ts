// A fully written owner file is linked atomically beside the database. Live owners never expire by timeout.
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { link, open, readFile, realpath, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';

interface Owner { pid: number; token: string; identity?: string }
export interface TrackerSyncLease { assertOwned(): Promise<void>; release(): Promise<void> }
export class TrackerSyncLockLost extends Error {}
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST';
const validOwner = (value: unknown): value is Owner => typeof value === 'object' && value !== null
  && Number.isSafeInteger((value as Owner).pid) && (value as Owner).pid > 0
  && typeof (value as Owner).token === 'string' && /^[a-f0-9-]{36}$/.test((value as Owner).token)
  && ((value as Owner).identity === undefined || typeof (value as Owner).identity === 'string' && (value as Owner).identity!.length > 0 && (value as Owner).identity!.length <= 512);
const run = promisify(execFile);
let boot: Promise<string> | undefined;
let self: Promise<string> | undefined;
async function processIdentity(pid: number): Promise<string> {
  if (pid === process.pid && self) return self;
  const read = async () => {
    if (process.platform === 'linux') {
      boot ??= readFile('/proc/sys/kernel/random/boot_id', 'utf8').then(value => value.trim());
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      // Field 22 follows the parenthesized command, which may itself contain spaces or parentheses.
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      if (!start || !/^\d+$/.test(start)) throw Error('The structural save owner could not be identified.');
      return `${await boot}:${start}`;
    }
    if (process.platform === 'darwin') {
      boot ??= run('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { timeout: 5000 }).then(result => result.stdout.trim());
      const { stdout } = await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 5000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
      if (!stdout.trim()) throw Error('The structural save owner could not be identified.');
      return `${await boot}:${stdout.trim()}`;
    }
    throw Error('Structural save process identity is unavailable on this platform.');
  };
  const result = read();
  if (pid === process.pid) self = result;
  return result;
}
async function ownerAt(path: string): Promise<Owner | null> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) { if (missing(error)) return null; throw error; }
  let owner: unknown;
  try { owner = JSON.parse(text); } catch { throw Error('The structural save lock has invalid ownership data.'); }
  if (!validOwner(owner)) throw Error('The structural save lock has invalid ownership data.');
  return owner;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; if ((error as NodeJS.ErrnoException).code === 'EPERM') return true; throw error; }
}
async function ownsProcess(owner: Owner): Promise<boolean> {
  if (!alive(owner.pid)) return false;
  // Preserve a live legacy owner; new owners also prove boot and process-start identity against PID reuse.
  if (!owner.identity) return true;
  try { return await processIdentity(owner.pid) === owner.identity; }
  catch { return alive(owner.pid); }
}
async function releasePath(path: string, owner: Owner): Promise<void> {
  if ((await ownerAt(path))?.token !== owner.token) return;
  try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
}

/** Busy callers return immediately. A dead owner's generation gets its own atomic recovery guard. */
export async function acquireTrackerSyncLock(database: string): Promise<TrackerSyncLease | null> {
  const path = `${await realpath(database)}.structure-sync.lock`;
  const owner: Owner = { pid: process.pid, token: randomUUID(), identity: await processIdentity(process.pid) };
  const candidate = `${path}.owner.${owner.pid}.${owner.token}`;
  const file = await open(candidate, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(owner)); }
  catch (error) { try { await unlink(candidate); } catch { /* Preserve the write error. */ } throw error; }
  finally { await file.close(); }
  const acquirePath = async (target: string, depth = 0): Promise<boolean> => {
    if (depth > 8) throw Error('The structural save lock has too many interrupted recovery attempts.');
    for (let attempt = 0; attempt < 4; attempt++) {
      try { await link(candidate, target); return true; } catch (error) { if (!exists(error)) throw error; }
      const previous = await ownerAt(target);
      if (!previous) continue;
      if (await ownsProcess(previous)) return false;
      // Only one reaper of this exact dead generation may remove it. A newer owner is never removed.
      const recovery = `${target}.recover.${previous.token}`;
      if (!await acquirePath(recovery, depth + 1)) return false;
      try {
        if ((await ownerAt(target))?.token !== previous.token) continue;
        try { await unlink(target); } catch (error) { if (!missing(error)) throw error; }
        if (target === path) {
          try { await unlink(`${path}.owner.${previous.pid}.${previous.token}`); } catch (error) { if (!missing(error)) throw error; }
        }
        try { await link(candidate, target); return true; } catch (error) { if (!exists(error)) throw error; return false; }
      } finally { await releasePath(recovery, owner); }
    }
    return false;
  };
  try {
    if (!await acquirePath(path)) { await unlink(candidate); return null; }
  } catch (error) { try { await unlink(candidate); } catch { /* The acquisition error remains the useful diagnosis. */ } throw error; }
  let released = false;
  return {
    async assertOwned() {
      if (released || (await ownerAt(path))?.token !== owner.token) throw new TrackerSyncLockLost('Another process owns this structural save now.');
    },
    async release() {
      if (released) return;
      released = true;
      try { await releasePath(path, owner); } finally { try { await unlink(candidate); } catch (error) { if (!missing(error)) throw error; } }
    },
  };
}
