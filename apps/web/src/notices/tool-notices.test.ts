// The notices for a missing t3, or a missing or logged-out gh, and their Recheck.
// Ported from the tool notice cases of test/render.test.ts and its saved copies.

import { afterEach, expect, test } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, stream } from './support.ts';
import type { BoardData, ToolProblems } from '@mux-factory/shared';

const withTools = (tools: ToolProblems, fields: Partial<BoardData> = {}): BoardData => ({ ...sample, tools, ...fields });
const failed = { error: 'gh api graphql failed: HTTP 401' };
const recheckButton = () => $<HTMLButtonElement>('[data-recheck]')!;
const note = () => $('.recheck-note');
const push = (data: BoardData) => settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(data) })));
const rechecks = () => fetchMock.mock.calls.filter(([url]) => url === '/api/recheck');

/** The next POST waits until the test answers it, so Checking… can be seen. */
let answer: (response: Response | Error) => Promise<void>;
function holdRecheck(): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url !== '/api/recheck') return new Response(JSON.stringify(sample));
    return new Promise<Response>((resolve, reject) => {
      answer = (response) => settle(() => response instanceof Error ? reject(response) : resolve(response));
    });
  });
}
const board = (data: BoardData) => new Response(JSON.stringify({ error: null, board: data }));

afterEach(() => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(sample)));
});

test('a missing t3 replaces the board with a notice and Recheck', async () => {
  await mountPage(withTools({ t3: { problem: 'missing' } }));
  const notice = $('main.tool-missing .tool-missing-box')!;
  expect(notice.getAttribute('role')).toBe('alert');
  expect(notice.querySelector('h1')!.textContent).toBe('T3 Code not found');
  expect(notice.querySelector('h1 svg.brand-mark')).not.toBeNull();
  expect(notice.querySelector('p')!.textContent).toBe("The board starts threads through T3 Code's t3 command and didn't find it on the login shell's PATH, "
    + 'in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck. The board also looks again every 10 seconds.');
  expect(recheckButton().textContent).toBe('Recheck');
  expect($('#panel-board'), 'the notice replaces the board').toBeNull();
  expect($('header.top')).toBeNull();
});

test('a t3 override that points nowhere is named', async () => {
  await mountPage(withTools({ t3: { problem: 'missing', override: 'T3_PATH=/nowhere/t3' } }));
  expect($('.tool-missing-box p')!.textContent).toBe('No runnable t3 is at T3_PATH=/nowhere/t3. Point T3_PATH at the T3 Code CLI or unset it, '
    + 'then press Recheck. The board also looks again every 10 seconds.');
  expect($$('.tool-missing-box code').map((c) => c.textContent)).toEqual(['t3', 'T3_PATH=/nowhere/t3']);
});

test('a missing or logged-out gh shows its own notice instead of Stale', async () => {
  await mountPage(withTools({ gh: { problem: 'missing' } }, failed));
  const banners = () => $$('header .banner');
  expect(banners().length).toBe(1);
  expect(banners()[0]!.getAttribute('role')).toBe('alert');
  expect(banners()[0]!.textContent).toBe('GitHub CLI not found. The board reads the project through gh. Install it with brew install gh Copy, '
    + 'then press Recheck. The board also looks again every 10 seconds. Recheck');
  expect(banners()[0]!.querySelector('button.copy:not([data-recheck])')!.getAttribute('aria-label')).toBe('Copy brew install gh');

  await push(withTools({ gh: { problem: 'logged-out' } }, failed));
  expect(banners().length).toBe(1);
  expect(banners()[0]!.textContent).toBe('GitHub CLI is logged out. The board reads the project through gh. Run gh auth login Copy in a terminal, '
    + 'then press Recheck. The board also looks again every 10 seconds. Recheck');

  await push(withTools({ gh: { problem: 'missing', override: 'GH_PATH=/nowhere/gh' } }));
  expect(banners()[0]!.textContent).toContain('No runnable gh is at GH_PATH=/nowhere/gh. Point GH_PATH at gh or unset it, then press Recheck.');

  await push(withTools({}, failed));
  expect(banners().map((b) => b.textContent), 'other read failures stay Stale').toEqual([expect.stringMatching(/^Stale\. .*HTTP 401/)]);
});

test('Recheck posts, shows Checking…, then the board once the tool is found, and keeps focus', async () => {
  holdRecheck();
  await mountPage(withTools({ t3: { problem: 'missing' } }));
  recheckButton().focus();
  await settle(() => recheckButton().click());
  expect([recheckButton().textContent, recheckButton().disabled]).toEqual(['Checking…', true]);
  await settle(() => recheckButton().click());
  expect(rechecks().length, 'one Recheck at a time').toBe(1);
  expect(note(), 'nothing while checking').toBeNull();

  await answer(board(withTools({ t3: { problem: 'missing' } })));
  expect([recheckButton().textContent, recheckButton().disabled]).toEqual(['Recheck', false]);
  expect([note()!.getAttribute('role'), note()!.textContent]).toEqual(['status', 'Still not found.']);
  expect(document.activeElement, 'focus goes back to Recheck').toBe(recheckButton());

  await settle(() => recheckButton().click());
  await answer(board(withTools({})));
  expect($('.tool-missing')).toBeNull();
  expect($('#panel-board')).not.toBeNull();
});

test("after Recheck a gh banner says it's still logged out, or why Recheck failed, until the server answers again", async () => {
  holdRecheck();
  const loggedOut = withTools({ gh: { problem: 'logged-out' } });
  await mountPage(loggedOut);
  expect(note(), 'nothing before a Recheck').toBeNull();
  await settle(() => recheckButton().click());
  await answer(board(loggedOut));
  expect(note()!.textContent).toBe('Still logged out.');
  await push(loggedOut);
  expect(note()!.textContent, 'stays across polls while gh is still logged out').toBe('Still logged out.');

  await settle(() => recheckButton().click());
  await answer(new TypeError('Failed to fetch'));
  expect(note()!.textContent).toBe("Can't reach the board server. Try again.");
  await push(loggedOut);
  expect(note(), 'gone once the server answers again').toBeNull();
});

test('a Recheck note answers only the tool problems it found, and goes once they change', async () => {
  holdRecheck();
  const loggedOut = withTools({ gh: { problem: 'logged-out' } });
  await mountPage(loggedOut);
  await settle(() => recheckButton().click());
  await answer(board(loggedOut));
  expect(note()!.textContent).toBe('Still logged out.');

  await push(withTools({ gh: { problem: 'missing' } }));
  expect(note(), 'a different problem is not what Recheck answered').toBeNull();
  await push(withTools({}));
  await push(loggedOut);
  expect(recheckButton()).not.toBeNull();
  expect(note(), 'a gh that logs out again opens a banner without the note').toBeNull();
});
