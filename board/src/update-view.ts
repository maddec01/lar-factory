// What the page shows about a board update besides the server's progress: its own request, or a
// board that didn't come back; and the hint for each step an update can fail at.

import type { UpdateStep } from './model.ts';

export type UpdateView = { phase: 'starting' } | { phase: 'refused'; message: string } | { phase: 'lost' };

/** How long after it finished a successful update still shows its toast on a new page. */
export const UPDATE_RESULT_MS = 15 * 60 * 1000;

export const UPDATE_HINTS: Record<UpdateStep, string> = {
  check: 'Put the checkout back on a clean main, then press Update.',
  fetch: 'Check GitHub access and reconcile local main with origin/main, then press Update.',
  install: 'pnpm install failed; fix what the message or log shows, then press Update.',
  restart: 'The launch agent could not be reinstalled; fix what the log shows, then press Update.',
  health: 'The new board did not answer in time; check the board log, then press Update.',
  skills: 'The skills install failed; check the gh login and the log, then press Update.',
  profiles: 'Resolve the conflicting skill links in the log, then press Update.',
  done: 'Press Update to retry.',
};
