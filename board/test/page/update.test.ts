// Update on the launch-agent board: the button, the banner and toast for each phase, and following
// the update until the board restarts, then reloading onto it.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, fetchMock, mountPage, sample, settle, stream } from './support.ts';
import type { BoardData, CodeUpdate, UpdateProgress } from '../../src/model.ts';

const command = "bash '/Users/pedro/Developer/Mux/mux-factory/board/scripts/update.sh'";
const codeUpdate: CodeUpdate = { runningRevision: 'a'.repeat(40), remoteRevision: 'a'.repeat(40), behind: 0, error: null, command, updatable: true,
  logs: { update: '/Users/pedro/Library/Logs/mux-board-update.log', board: '/Users/pedro/Library/Logs/mux-board.log' } };
const behind: CodeUpdate = { ...codeUpdate, remoteRevision: 'b'.repeat(40), behind: 1 };
const running: UpdateProgress = { state: 'running', pid: 1, finished: ['check', 'fetch'], current: 'install',
  startedAt: '2026-10-21T09:59:00Z', finishedAt: null, revision: 'b'.repeat(40), error: null, logTail: null };
const failed: UpdateProgress = { ...running, state: 'failed', finishedAt: '2026-10-21T09:59:30Z',
  error: 'pnpm exited with code 1.', logTail: 'ERR_PNPM_OUTDATED_LOCKFILE missing lockfile\n<script>' };
const done: UpdateProgress = { ...running, state: 'done', current: null,
  finished: ['check', 'fetch', 'install', 'restart', 'health', 'skills', 'profiles', 'done'], finishedAt: '2026-10-21T09:59:50Z' };
const board = (fields: Partial<BoardData> = {}): BoardData => ({ ...sample, error: null, fetchedAt: new Date(NOW).toISOString(),
  capture: { session: 'one', enabled: true }, codeUpdate: behind, ...fields });

const updateButtons = () => $$<HTMLButtonElement>('[data-update]');
const banner = (text: string) => $$('.banner').find((el) => el.textContent!.includes(text));
const serve = (data: BoardData) => fetchMock.mockImplementation(async () => new Response(JSON.stringify(data)));
const respond = (body: object, status = 200) => fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
const posts = () => fetchMock.mock.calls.filter(([url]) => url === '/api/update');

/** Runs the clock a second at a time, so each poll finishes before the next one starts. */
async function seconds(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await settle(() => vi.advanceTimersByTime(1_000));
}

async function reloads() {
  const { restart } = await import('../../src/app/live-data.ts');
  return vi.spyOn(restart, 'reload').mockImplementation(() => {});
}

test('a board that cannot update itself shows a copyable command, and the check failing or still running', async () => {
  await mountPage(board({ codeUpdate: { ...behind, updatable: false } }));
  const notice = banner('Board update available')!;
  expect(notice.getAttribute('role')).toBe('status');
  expect(notice.textContent).toBe(`Board update available. Run ${command} Copy`);
  expect(notice.querySelector('button')!.getAttribute('aria-label')).toBe('Copy board update command');
  expect(updateButtons()).toEqual([]);

  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(board({ codeUpdate: { ...behind, updatable: false, error: 'Network unavailable.' } })) })));
  expect(banner('Board update available')).toBeDefined();
  expect(banner('Board update check failed')!.textContent).toBe('Board update check failed. Network unavailable.');

  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(board({ codeUpdate: { ...behind, updatable: false, behind: null } })) })));
  expect(banner('Checking for board updates…')).toBeDefined();
  expect(banner('Board update available')).toBeUndefined();
});

test('the launch-agent board offers Update in the header, or on the banner when behind', async () => {
  await mountPage(board({ codeUpdate }));
  expect(updateButtons().length).toBe(1);
  expect(updateButtons()[0]!.closest('.title-row')).not.toBeNull();
  expect(updateButtons()[0]!.getAttribute('aria-label')).toBe('Update the board and skills');
  expect($('.banner')).toBeNull();
});

test('behind, Update replaces the copy button on the banner', async () => {
  await mountPage(board());
  expect(updateButtons().length).toBe(1);
  expect(updateButtons()[0]!.closest('.code-update')!.textContent).toBe('Board update available. Update');
  expect(banner('Board update available')!.querySelector('[aria-label="Copy board update command"]')).toBeNull();
});

test('a running update shows its steps as they finish, and Update waits in the header', async () => {
  await mountPage(board({ update: running }));
  const progress = banner('Updating the board and skills…')!;
  expect(progress.getAttribute('role')).toBe('status');
  expect(progress.querySelector('ol')!.getAttribute('aria-label')).toBe('Update steps');
  expect(progress.querySelector('ol')!.innerHTML).toBe('<li class="finished">check</li><li class="finished">fetch</li><li class="current" aria-current="step">install</li>');
  expect(progress.querySelector('.dismiss'), 'progress has nothing to close').toBeNull();
  expect(banner('Board update available'), 'the progress replaces the notice').toBeUndefined();
  expect(updateButtons().length).toBe(1);
  expect(updateButtons()[0]!.closest('.title-row')).not.toBeNull();
  expect(updateButtons()[0]!.textContent).toBe('Updating…');
  expect(updateButtons()[0]!.getAttribute('aria-disabled')).toBe('true');
  await settle(() => updateButtons()[0]!.click());
  expect(posts()).toEqual([]);
});

test('a failed update stays, however old, with its log and hint, until it is closed', async () => {
  await mountPage(board({ update: { ...failed, finishedAt: '2026-10-21T09:00:00Z' } }));
  const failure = banner('Update failed at install')!;
  expect(failure.getAttribute('role')).toBe('alert');
  expect(failure.querySelector('strong')!.textContent).toBe('Update failed at install.');
  expect(failure.querySelector('.update-steps .failed')!.textContent).toBe('install');
  expect(failure.querySelector('pre.update-log')!.textContent).toBe('ERR_PNPM_OUTDATED_LOCKFILE missing lockfile\n<script>');
  expect(failure.querySelector('script')).toBeNull();
  expect(failure.querySelector('.update-hint')!.textContent).toBe(
    'pnpm install failed; fix what the message or log shows, then press Update. Full log: /Users/pedro/Library/Logs/mux-board-update.log');
  expect(updateButtons().map((b) => b.textContent), 'Update is there again to retry').toEqual(['Update']);

  const close = failure.querySelector<HTMLButtonElement>('.dismiss')!;
  expect(close.getAttribute('aria-label')).toBe('Dismiss: update failed');
  await settle(() => close.click());
  expect(banner('Update failed')).toBeUndefined();
});

test('a finished update is a toast that clears itself, and an old one is gone', async () => {
  await mountPage(board({ codeUpdate, update: done }));
  const toast = $('.toast')!;
  expect(toast.getAttribute('role')).toBe('status');
  expect(toast.textContent).toBe('×Update finished. The board now runs bbbbbbb, with the skills and checklists from main.');
  expect(toast.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: update finished');
  await settle(() => vi.advanceTimersByTime(5_000));
  expect($('.toast')).toBeNull();

  vi.resetModules();
  await mountPage(board({ codeUpdate, update: { ...done, finished: ['check', 'fetch', 'skills', 'profiles', 'done'] } }));
  expect($('.toast')!.textContent).toContain('The board was already current; the skills and checklists are updated from main.');

  vi.resetModules();
  await mountPage(board({ codeUpdate, update: { ...done, finishedAt: '2026-10-21T09:00:00Z' } }));
  expect($('.toast')).toBeNull();
});

test("an update that didn't start says why until it is closed, and closed it shows an update someone else started", async () => {
  await mountPage(board());
  let answer!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)));
  await settle(() => updateButtons()[0]!.click());
  expect(posts().length).toBe(1);
  expect(updateButtons()[0]!.textContent).toBe('Updating…');
  expect(updateButtons()[0]!.getAttribute('aria-disabled')).toBe('true');

  await settle(() => answer(new Response(JSON.stringify({ error: 'A Start is running. Press Update when it finishes.', board: board() }), { status: 409 })));
  const refused = banner("The update didn't start")!;
  expect(refused.getAttribute('role')).toBe('alert');
  expect(refused.textContent).toBe("×The update didn't start. A Start is running. Press Update when it finishes.");
  expect(refused.querySelector('.dismiss')!.getAttribute('aria-label')).toBe("Dismiss: the update didn't start");
  expect(updateButtons()[0]!.textContent).toBe('Update');

  await settle(() => refused.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(banner("didn't start")).toBeUndefined();
  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(board({ update: running })) })));
  expect(banner('Updating the board and skills…')).toBeDefined();
});

test('a started update is polled every second, and the restarted board reloads the page', async () => {
  await mountPage(board());
  const reload = await reloads();
  await settle(() => stream().onopen!());
  respond({ error: null, board: board({ update: { ...running, finished: [], current: 'check' } }) }, 202);
  await settle(() => updateButtons()[0]!.click());
  expect(banner('Updating the board and skills…')).toBeDefined();

  serve(board({ update: running }));
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(fetchMock.mock.calls.at(-1)![0], 'the stream drops in a restart, so the page polls').toBe('/api/board');
  expect($('.update-steps .current')!.textContent).toBe('install');

  // The board goes away while it restarts: no error, and no reload yet.
  fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await settle(() => vi.advanceTimersByTime(5_000));
  expect(banner("Can't reach")).toBeUndefined();
  expect(reload).not.toHaveBeenCalled();

  serve(board({ capture: { session: 'two', enabled: true }, update: done }));
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(reload).toHaveBeenCalledOnce();
});

test('an update that finished without a restart does not reload', async () => {
  await mountPage(board({ update: running }));
  const reload = await reloads();
  serve(board({ update: { ...done, finished: ['check', 'fetch', 'skills', 'profiles', 'done'] } }));
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(reload).not.toHaveBeenCalled();
  expect($('.toast')!.textContent).toContain('already current');
  const polls = fetchMock.mock.calls.length;
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(fetchMock.mock.calls.length, 'back to the 15 s poll').toBe(polls);
});

test("a board that stays away for 30 s says it didn't restart, until it comes back", async () => {
  await mountPage(board({ update: running }));
  fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await seconds(30);
  expect(banner("didn't restart")).toBeUndefined();
  await seconds(2);
  const lost = banner("The board didn't restart")!;
  expect(lost.getAttribute('role')).toBe('alert');
  expect(lost.textContent).toBe(`×The board didn't restart. Check /Users/pedro/Library/Logs/mux-board.log and /Users/pedro/Library/Logs/mux-board-update.log, then run ${command} in a terminal. Copy`);
  expect(lost.querySelector('.dismiss')!.getAttribute('aria-label')).toBe("Dismiss: the board didn't restart");
  expect(lost.querySelector('.copy')!.getAttribute('aria-label')).toBe('Copy board update command');
  expect(banner("Can't reach")).toBeUndefined();
  expect(updateButtons()[0]!.textContent, 'Update is there again').toBe('Update');

  const polls = fetchMock.mock.calls.length;
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(fetchMock.mock.calls.length, 'lost, the page polls every 15 s').toBe(polls);

  await settle(() => lost.querySelector<HTMLButtonElement>('.dismiss')!.click());
  expect(banner("didn't restart")).toBeUndefined();

  serve(board({ update: running }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(banner('Updating the board and skills…')).toBeDefined();
});
