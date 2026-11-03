// Test support for the processes tests start: helpers exit with the process running the test file, and bounded cleanup
// stops the rest before their temp folder goes. Only wrappers a test started and pids from its own log are signalled.
import { spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A hook timeout above the sum of the waits in `stopHelpers`, which is 8s. */
export const STOP_HELPERS_MS = 15_000;

/** Helper code that ends its process once `runner` is gone. It uses no signal, so a helper ignoring SIGTERM obeys it. */
export const exitWithRunner = (runner = process.pid) => `setInterval(() => { try { process.kill(${runner}, 0); } catch { process.exit(1); } }, 1000).unref();`;
/** Helper code that logs its pid to `folder`'s log for `stopHelpers` and ends it with the runner. It needs CommonJS. */
export const helperStart = (folder: string) => `require('node:fs').appendFileSync(${JSON.stringify(join(folder, 'log'))}, 'start helper ' + process.pid + '\\n'); ${exitWithRunner()}`;

export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export interface Helpers {
  /** The test's temp folders. A helper's pid is read from `log` in its folder, and its command names that folder. */
  folders: string[];
  wrappers: ChildProcess[];
  /** Files whose existence tells a helper to end. */
  gates: string[];
}
type HelperRunning = (pid: number, folder: string) => boolean;

/** The pid's command line, empty once it's gone, or null when `ps` can't say. */
const commandOf = (pid: number) => {
  const ps = spawnSync('ps', ['-ww', '-o', 'command=', '-p', String(pid)], { encoding: 'utf8', timeout: 1000 });
  return ps.error ? null : ps.stdout;
};
const names = (command: string | null, folder: string) => command?.includes(`${folder}/`) ?? false;
const helperRunning: HelperRunning = (pid, folder) => { const command = commandOf(pid); return command === null || names(command, folder); };
const loggedPids = (folder: string) => {
  let log: string;
  try { log = readFileSync(join(folder, 'log'), 'utf8'); } catch { return []; }
  return [...log.matchAll(/^start \S+ (\d+)/gm)].map(match => Number(match[1]));
};
async function waitFor(done: () => boolean, ms: number) {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await new Promise(wake => setTimeout(wake, 50));
}

/**
 * Stops every wrapper and logged helper, then removes the folders. Opens the gates, then SIGTERMs wrappers, whose grace
 * period kills their command group, then SIGKILLs what remains. Throws naming any pid still running, keeping the folders
 * that pid may need. `running` replaces the liveness check, and never the check before a signal.
 */
export async function stopHelpers({ folders, wrappers, gates }: Helpers, running = helperRunning) {
  for (const gate of gates) try { writeFileSync(gate, ''); } catch { /* Its folder is gone. */ }
  const liveWrappers = () => wrappers.filter(wrapper => wrapper.exitCode === null && wrapper.signalCode === null);
  const liveHelpers = () => folders.flatMap(folder => loggedPids(folder).filter(pid => running(pid, folder)).map(pid => ({ pid, folder })));
  // One deadline per step across all wrappers, since a test can start six.
  await waitFor(() => !liveWrappers().length, 1000);
  for (const wrapper of liveWrappers()) wrapper.kill('SIGTERM');
  await waitFor(() => !liveWrappers().length, 5000);
  await waitFor(() => !liveHelpers().length, 1000);
  for (const wrapper of liveWrappers()) wrapper.kill('SIGKILL');
  for (const { pid, folder } of liveHelpers()) {
    if (!names(commandOf(pid), folder)) continue;
    try { process.kill(pid, 'SIGKILL'); } catch { /* It just ended. */ }
  }
  await waitFor(() => !liveWrappers().length && !liveHelpers().length, 1000);
  const wrappersLeft = liveWrappers();
  const helpersLeft = liveHelpers();
  const kept = wrappersLeft.length ? folders : helpersLeft.map(helper => helper.folder);
  for (const folder of folders) if (!kept.includes(folder)) rmSync(folder, { recursive: true, force: true });
  const pids = [...wrappersLeft.map(wrapper => wrapper.pid), ...helpersLeft.map(helper => helper.pid)];
  if (pids.length) throw Error(`Test helper still running after SIGKILL: pid ${pids.join(', ')}. Kept ${[...new Set(kept)].join(', ')}.`);
}
