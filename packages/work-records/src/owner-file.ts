// Owner files: a fully written owner file is linked atomically to a lock path, so a reader never sees a partial one.
// The owner's process identity survives PID reuse on macOS and Linux. Live owners never expire by timeout.
import { execFile } from 'node:child_process';
import { link, open, readFile, unlink } from 'node:fs/promises';
import { promisify } from 'node:util';

export interface Owner { pid: number; token: string; identity?: string }
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST';
const validOwner = (value: unknown): value is Owner => typeof value === 'object' && value !== null
  && Number.isSafeInteger((value as Owner).pid) && (value as Owner).pid > 0
  && typeof (value as Owner).token === 'string' && /^[a-f0-9-]{36}$/.test((value as Owner).token)
  && ((value as Owner).identity === undefined || typeof (value as Owner).identity === 'string' && (value as Owner).identity!.length > 0 && (value as Owner).identity!.length <= 512);
const run = promisify(execFile);
let boot: Promise<string> | undefined;
let self: Promise<string> | undefined;
export async function processIdentity(pid: number): Promise<string> {
  if (pid === process.pid && self) return self;
  const read = async () => {
    if (process.platform === 'linux') {
      boot ??= readFile('/proc/sys/kernel/random/boot_id', 'utf8').then(value => value.trim());
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      // Field 22 follows the parenthesized command, which may itself contain spaces or parentheses.
      const start = stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[19];
      if (!start || !/^\d+$/.test(start)) throw Error('The lock owner could not be identified.');
      return `${await boot}:${start}`;
    }
    if (process.platform === 'darwin') {
      boot ??= run('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], { timeout: 5000 }).then(result => result.stdout.trim());
      const { stdout } = await run('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 5000, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
      if (!stdout.trim()) throw Error('The lock owner could not be identified.');
      return `${await boot}:${stdout.trim()}`;
    }
    throw Error('Lock owner process identity is unavailable on this platform.');
  };
  const result = read();
  if (pid === process.pid) self = result;
  return result;
}
/** The owner linked at `path`, or null when none is. */
export async function ownerAt<T extends Owner = Owner>(path: string): Promise<T | null> {
  let text: string;
  try { text = await readFile(path, 'utf8'); } catch (error) { if (missing(error)) return null; throw error; }
  let owner: unknown;
  try { owner = JSON.parse(text); } catch { throw Error(`The lock ${path} has invalid ownership data.`); }
  if (!validOwner(owner)) throw Error(`The lock ${path} has invalid ownership data.`);
  return owner as T;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; if ((error as NodeJS.ErrnoException).code === 'EPERM') return true; throw error; }
}
export async function ownsProcess(owner: Owner): Promise<boolean> {
  if (!alive(owner.pid)) return false;
  // Preserve a live legacy owner; new owners also prove boot and process-start identity against PID reuse.
  if (!owner.identity) return true;
  try { return await processIdentity(owner.pid) === owner.identity; }
  catch { return alive(owner.pid); }
}
export async function releasePath(path: string, owner: Owner): Promise<void> {
  if ((await ownerAt(path))?.token !== owner.token) return;
  try { await unlink(path); } catch (error) { if (!missing(error)) throw error; }
}
/** The file `owner` writes under `base` before linking it to a lock path. */
export const ownerFile = (base: string, owner: Owner): string => `${base}.owner.${owner.pid}.${owner.token}`;

/** Writes `owner` whole to its owner file under `base` and returns that file's path. */
export async function writeOwnerFile(base: string, owner: Owner): Promise<string> {
  const candidate = ownerFile(base, owner);
  const file = await open(candidate, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(owner)); }
  catch (error) { try { await unlink(candidate); } catch { /* Preserve the write error. */ } throw error; }
  finally { await file.close(); }
  return candidate;
}

/**
 * Links `owner`'s owner file under `base` to `target`. A busy target returns false at once. A dead owner's generation
 * gets its own atomic recovery guard, and its owner file under `base` is removed with it.
 */
export async function claimPath(base: string, owner: Owner, target: string, depth = 0): Promise<boolean> {
  if (depth > 8) throw Error(`The lock ${target} has too many interrupted recovery attempts.`);
  const candidate = ownerFile(base, owner);
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await link(candidate, target); return true; } catch (error) { if (!exists(error)) throw error; }
    const previous = await ownerAt(target);
    if (!previous) continue;
    if (await ownsProcess(previous)) return false;
    // Only one reaper of this exact dead generation may remove it. A newer owner is never removed.
    const recovery = `${target}.recover.${previous.token}`;
    if (!await claimPath(base, owner, recovery, depth + 1)) return false;
    try {
      if ((await ownerAt(target))?.token !== previous.token) continue;
      try { await unlink(target); } catch (error) { if (!missing(error)) throw error; }
      if (depth === 0) {
        try { await unlink(ownerFile(base, previous)); } catch (error) { if (!missing(error)) throw error; }
      }
      try { await link(candidate, target); return true; } catch (error) { if (!exists(error)) throw error; return false; }
    } finally { await releasePath(recovery, owner); }
  }
  return false;
}
