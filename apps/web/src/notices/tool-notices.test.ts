// The notices for a missing t3, a gh that's missing, logged out, too old or without the project scope, or a missing git, jq or curl, and their Recheck.
// Ported from the tool notice cases of test/render.test.ts and its saved copies.

import { expect, test } from 'vite-plus/test';
import { $, $$, bannerText, fetchMock, mountPage, push, sample, settle, toolChecks } from '../../test/support.ts';
import type { BoardData, ToolChecks } from '@lar-factory/shared';

const withTools = (failed: Partial<ToolChecks>, fields: Partial<BoardData> = {}): BoardData => ({ ...sample, tools: toolChecks(failed), ...fields });
const failed = { error: 'gh api graphql failed: HTTP 401' };
const recheckButton = () => $<HTMLButtonElement>('[data-recheck]')!;
const note = () => $('.recheck-note');
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

test('a missing t3 replaces the main area with a notice and Recheck', async () => {
  await mountPage(withTools({ t3: { result: 'missing' } }));
  const notice = $('main .tool-missing .tool-missing-box')!;
  expect(notice.getAttribute('role')).toBe('alert');
  expect(notice.querySelector('h1')!.textContent).toBe('T3 Code not found');
  expect(notice.querySelector('h1 svg.brand-mark')).not.toBeNull();
  expect(notice.querySelector('p')!.textContent).toBe("The board starts threads through T3 Code's t3 command and didn't find it on the login shell's PATH, "
    + 'in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck. The board also looks again every 10 seconds.');
  expect(recheckButton().textContent).toBe('Recheck');
  expect($('.desk'), 'the notice replaces the desk and the line').toBeNull();
  expect($('.line')).toBeNull();
  expect($('.banners')).toBeNull();
});

test('a t3 override that points nowhere is named', async () => {
  await mountPage(withTools({ t3: { result: 'missing', override: 'T3_PATH=/nowhere/t3' } }));
  expect($('.tool-missing-box p')!.textContent).toBe('No runnable t3 is at T3_PATH=/nowhere/t3. Point T3_PATH at the T3 Code CLI or unset it, '
    + 'then press Recheck. The board also looks again every 10 seconds.');
  expect($$('.tool-missing-box code').map((c) => c.textContent)).toEqual(['t3', 'T3_PATH=/nowhere/t3']);
});

test('a missing or logged-out gh shows its own notice, and other read failures show none', async () => {
  await mountPage(withTools({ gh: { result: 'missing', fix: 'brew install gh' } }, failed));
  const banners = () => $$('.banners .banner');
  expect(banners().length).toBe(1);
  expect(banners()[0]!.getAttribute('role')).toBe('alert');
  expect(bannerText(banners()[0]!)).toEqual(['GitHub CLI not found.', 'The board reads the project through gh. Install it with brew install gh Copy, '
    + 'then press Recheck. The board also looks again every 10 seconds. Recheck']);
  expect(banners()[0]!.dataset.variant).toBe('warning');
  expect(banners()[0]!.querySelector('button[data-slot="button"]:not([data-recheck])')!.getAttribute('aria-label')).toBe('Copy brew install gh');

  await push(withTools({ gh: { result: 'logged-out', fix: 'gh auth login' } }, failed));
  expect(banners().length).toBe(1);
  expect(bannerText(banners()[0]!)).toEqual(['GitHub CLI is logged out.', 'The board reads the project through gh. Run gh auth login Copy in a terminal, '
    + 'then press Recheck. The board also looks again every 10 seconds. Recheck']);

  await push(withTools({ gh: { result: 'missing', override: 'GH_PATH=/nowhere/gh', fix: 'brew install gh' } }));
  expect(banners()[0]!.textContent).toContain('No runnable gh is at GH_PATH=/nowhere/gh. Point GH_PATH at gh or unset it, then press Recheck.');

  await push(withTools({}, failed));
  expect(banners(), 'a failed read is the title bar\'s to show').toEqual([]);
});

test('a gh older than 2.94.0 shows its banner with brew upgrade gh, and the board still shows', async () => {
  await mountPage(withTools({ gh: { result: 'outdated', version: '2.93.1', fix: 'brew upgrade gh' } }));
  expect($$('.banners .banner').map(bannerText)).toEqual([['GitHub CLI is older than 2.94.0.', 'lar-work’s scripts need the --parent, '
    + '--add-sub-issue and --blocked-by flags that gh 2.94.0 added, and this gh is 2.93.1. Run brew upgrade gh Copy in a terminal, '
    + 'then press Recheck. Recheck']]);
  expect($('.desk')).not.toBeNull();
});

test('a login without the project scope shows its banner with gh auth refresh -s project', async () => {
  holdRecheck();
  const noScope = withTools({ gh: { result: 'no-project-scope', fix: 'gh auth refresh -s project' } });
  await mountPage(noScope);
  expect($$('.banners .banner').map(bannerText)).toEqual([['GitHub CLI can\'t read Projects.', 'The board reads the GitHub Project through gh, '
    + 'and your gh login has no project scope. Run gh auth refresh -s project Copy in a terminal, '
    + 'then press Recheck. The board also looks again every 10 seconds. Recheck']]);
  await settle(() => recheckButton().click());
  await answer(board(noScope));
  expect(note()!.textContent).toBe("Still can't read Projects.");
});

test('a login without the project scope on a gh older than 2.94.0 shows both banners', async () => {
  await mountPage(withTools({ gh: { result: 'no-project-scope', version: '2.93.1', fix: 'gh auth refresh -s project', upgrade: 'brew upgrade gh' } }));
  const banners = $$('.banners .banner').map(bannerText);
  expect(banners.map(([title]) => title)).toEqual(["GitHub CLI can't read Projects.", 'GitHub CLI is older than 2.94.0.']);
  expect(banners[0]![1], 'a login without the scope stops the read, so the board looks again').toContain('looks again every 10 seconds');
  expect(banners[1]![1]).toContain('this gh is 2.93.1. Run brew upgrade gh Copy in a terminal, then press Recheck. Recheck');
});

test('a login without the project scope shows no banner while no repository reads a Project', async () => {
  const issuesOnly = sample.repos.map((r) => ({ ...r, items: 'issues' as const }));
  await mountPage(withTools({ gh: { result: 'no-project-scope', fix: 'gh auth refresh -s project' } }, { repos: issuesOnly }));
  expect($$('.banners .banner')).toEqual([]);
});

test('with no repositories, a login without the project scope on a gh older than 2.94.0 shows only the too-old banner', async () => {
  await mountPage(withTools({ gh: { result: 'no-project-scope', version: '2.93.1', fix: 'gh auth refresh -s project', upgrade: 'brew upgrade gh' } }, { repos: [] }));
  expect($$('.banners .banner').map(bannerText).map(([title]) => title)).toEqual(['GitHub CLI is older than 2.94.0.']);
});

test('scopes the board couldn\'t read show no banner', async () => {
  await mountPage(withTools({ gh: { result: 'ok', version: '2.102.0', scopes: 'unread' } }));
  expect($$('.banners .banner')).toEqual([]);
});

test('Recheck posts, shows Checking…, then the board once the tool is found, and keeps focus', async () => {
  holdRecheck();
  await mountPage(withTools({ t3: { result: 'missing' } }));
  recheckButton().focus();
  await settle(() => recheckButton().click());
  expect([recheckButton().textContent, recheckButton().disabled]).toEqual(['Checking…', true]);
  await settle(() => recheckButton().click());
  expect(rechecks().length, 'one Recheck at a time').toBe(1);
  expect(note(), 'nothing while checking').toBeNull();

  await answer(board(withTools({ t3: { result: 'missing' } })));
  expect([recheckButton().textContent, recheckButton().disabled]).toEqual(['Recheck', false]);
  expect([note()!.getAttribute('role'), note()!.textContent]).toEqual(['status', 'Still not found.']);
  expect(document.activeElement, 'focus goes back to Recheck').toBe(recheckButton());

  await settle(() => recheckButton().click());
  await answer(board(withTools({})));
  expect($('.tool-missing')).toBeNull();
  expect($('.desk')).not.toBeNull();
});

test("after Recheck a gh banner says it's still logged out, or why Recheck failed, until the server answers again", async () => {
  holdRecheck();
  const loggedOut = withTools({ gh: { result: 'logged-out', fix: 'gh auth login' } });
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
  const loggedOut = withTools({ gh: { result: 'logged-out', fix: 'gh auth login' } });
  await mountPage(loggedOut);
  await settle(() => recheckButton().click());
  await answer(board(loggedOut));
  expect(note()!.textContent).toBe('Still logged out.');

  await push(withTools({ gh: { result: 'missing', fix: 'brew install gh' } }));
  expect(note(), 'a different problem is not what Recheck answered').toBeNull();
  await push(withTools({}));
  await push(loggedOut);
  expect(recheckButton()).not.toBeNull();
  expect(note(), 'a gh that logs out again opens a banner without the note').toBeNull();
});

test('a missing git, jq or curl shows a banner with its install command and Recheck, and the board still shows', async () => {
  await mountPage(withTools({ jq: { result: 'missing', fix: 'brew install jq' } }));
  const banners = () => $$('.banners .banner');
  expect(banners().map(bannerText)).toEqual([['jq not found.', 'lar-work’s scripts read gh’s answers with jq. Install it with brew install jq Copy, '
    + 'then press Recheck. Recheck']]);
  expect(banners()[0]!.querySelector('button[data-slot="button"]:not([data-recheck])')!.getAttribute('aria-label')).toBe('Copy brew install jq');
  expect($('.desk')).not.toBeNull();

  await push(withTools({ git: { result: 'missing', override: 'GIT_PATH=/nowhere/git', fix: 'brew install git' }, curl: { result: 'missing', fix: 'brew install curl' } }));
  expect(banners().map((b) => bannerText(b)[0])).toEqual(['git not found.', 'curl not found.']);
  expect(bannerText(banners()[0]!)[1]).toBe('lar-work’s agents branch, commit and push with git. No runnable git is at GIT_PATH=/nowhere/git. '
    + 'Point GIT_PATH at git, or unset it and install it with brew install git Copy, then press Recheck. Recheck');
  expect(bannerText(banners()[1]!)[1]).toContain('lar-work’s scripts tell the board to refresh with curl. Install it with brew install curl Copy');
});

test('an az that fails its check shows a banner with its fix, and the board still shows', async () => {
  holdRecheck();
  const loggedOut = withTools({ az: { result: 'logged-out', version: '2.67.0', fix: 'az login' } });
  await mountPage(loggedOut);
  const banners = () => $$('.banners .banner');
  expect(banners().map(bannerText)).toEqual([['Azure CLI is logged out.', 'The board reads repositories on Azure DevOps through az. '
    + 'Run az login Copy in a terminal, then press Recheck. Recheck']]);
  expect($('.desk')).not.toBeNull();
  await settle(() => recheckButton().click());
  await answer(board(loggedOut));
  expect(note()!.textContent).toBe('Still logged out.');

  await push(withTools({ az: { result: 'no-extension', fix: 'az extension add --name azure-devops' } }));
  expect(bannerText(banners()[0]!)).toEqual(['Azure CLI has no azure-devops extension.', 'The board reads repositories on Azure DevOps through az. '
    + 'Run az extension add --name azure-devops Copy in a terminal, then press Recheck. Recheck']);
  await push(withTools({ az: { result: 'missing', fix: 'brew install azure-cli' } }));
  expect(bannerText(banners()[0]!)[0]).toBe('Azure CLI not found.');
  expect(bannerText(banners()[0]!)[1]).toContain('Install it with brew install azure-cli Copy, then press Recheck.');
  await push(withTools({}));
  expect(banners(), 'an az nobody needs is not checked and shows nothing').toEqual([]);
});

test('T3 Code not running shows a banner with its fix and Recheck, and the board still shows', async () => {
  holdRecheck();
  const closed = withTools({ t3: { result: 'not-running', version: '0.1.3-nightly.1' } });
  await mountPage(closed);
  expect($$('.banners .banner').map(bannerText)).toEqual([['T3 Code is not running.', 'The board starts threads through T3 Code, which has to be open. '
    + 'Open T3 Code, then press Recheck. The board also looks again every 10 seconds. Recheck']]);
  expect($('.tool-missing'), 'only a missing t3 fills the main area').toBeNull();
  expect($('.desk')).not.toBeNull();
  expect($('.title-bar h1')).not.toBeNull();
  await settle(() => recheckButton().click());
  await answer(board(closed));
  expect(note()!.textContent).toBe('Still not running.');
  await push(withTools({}));
  expect($$('.banners .banner')).toEqual([]);
});
