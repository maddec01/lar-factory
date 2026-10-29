// Reset in Settings › Repositories. On a repository still onboarding the confirmation says whether it closes the
// onboarding PR or only drops the onboarding, Reset posts the repository and the board drops its row and card, and a
// close gh refuses keeps the confirmation open with gh's message. On an onboarded repository it says what the reset PR
// removes and what Reset leaves, and that it closes an open Edit PR, a toast links the reset PR, and a PR gh can't open keeps the row and shows gh's message.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text, toast } from '../../test/support.ts';
import type { BoardData, OnboardingProgress } from '@lar-factory/shared';

const REPO = 'maddec01/lar-web';
const PR = 'https://github.com/maddec01/lar-web/pull/14';
const progress: OnboardingProgress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
const waiting: OnboardingProgress = { ...progress, step: 'pr', done: ['project', 'setup', 'checks'], prUrl: PR };

type Answer = { status?: number; body: object };

/** Serves `data` as the board and `reset` for Reset, and returns the bodies Reset got. */
function serve(data: BoardData, reset: Answer = { body: { error: null, board: { ...data, onboarding: [] } } }) {
  const sent: object[] = [];
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    if (url !== '/api/repositories/reset') return new Response(JSON.stringify(data));
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reset.body), { status: reset.status ?? 200 });
  }) as typeof fetchMock);
  return sent;
}

const dialog = () => $('[data-reset-dialog]');
const row = (repo = REPO) => $(`.settings-row[data-row="repo-${repo}"]`);
const button = (within: Element, label: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!;

/** Opens Settings › Repositories on `data` and presses `repo`'s Reset. */
async function openReset(data: BoardData, repo = REPO): Promise<void> {
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  await settle(() => button(row(repo)!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
}

test('Reset of an onboarding waiting for its PR says it closes the PR, then closes it and drops the row and the card', async () => {
  const warnings = vi.spyOn(console, 'warn');
  const data: BoardData = { ...sample, onboarding: [{ repo: REPO, progress: waiting }] };
  const sent = serve(data);
  await openReset(data);
  expect(warnings.mock.calls.filter((args) => args.some((arg) => /Missing.*Description/.test(String(arg))))).toEqual([]);
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe(`Reset ${REPO}?`);
  expect(text(dialog()!.querySelector('#reset-detail'))).toBe(
    `Reset closes ${REPO}'s onboarding PR, maddec01/lar-web#14, and drops its onboarding from this Mac's list, with its Resume. It opens no PR, and leaves alone the T3 project and the repository's labels.`);
  expect(dialog()!.querySelector('#reset-detail a')!.getAttribute('href')).toBe(PR);
  expect(document.activeElement, 'focus starts on Cancel, not the PR link').toBe(button(dialog()!, 'Cancel'));
  await settle(() => button(dialog()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(sent).toEqual([{ repo: REPO }]);
  expect(dialog()).toBeNull();
  expect(row()).toBeNull();
  expect($(`[data-onboarding-card="${REPO}"]`)).toBeNull();
});

test.each([['no PR yet', progress], ['a closed PR', { ...waiting, prClosed: true }]] as [string, OnboardingProgress][])('Reset of an onboarding with %s says it only drops the onboarding', async (_, onboarding) => {
  const data: BoardData = { ...sample, onboarding: [{ repo: REPO, progress: onboarding }] };
  serve(data);
  await openReset(data);
  expect(text(dialog()!.querySelector('#reset-detail'))).toBe(
    `Reset drops ${REPO}'s onboarding from this Mac's list, with its Resume. It has no open PR to close, so it changes nothing on GitHub, and leaves alone the T3 project and the repository's labels.`);
  await settle(() => button(dialog()!, 'Cancel').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()).toBeNull();
  expect(row()).not.toBeNull();
});

test("a Reset whose PR gh can't close keeps the confirmation open with gh's message, and the row", async () => {
  const data: BoardData = { ...sample, onboarding: [{ repo: REPO, progress: waiting }] };
  serve(data, { status: 502, body: { error: `Can't close ${REPO}'s onboarding PR: HTTP 403: Resource not accessible` } });
  await openReset(data);
  await settle(() => button(dialog()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(`Can't resetCan't close ${REPO}'s onboarding PR: HTTP 403: Resource not accessible`);
  expect(button(dialog()!, 'Reset').disabled).toBe(false);
  await settle(() => button(dialog()!, 'Cancel').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(row(), 'Settings comes back with the row').not.toBeNull();
});

const ONBOARDED = sample.repos[0]!.repo;

test('Reset of an onboarded repository says what its PR removes, what it drops and what it leaves, then posts it, drops the row and links the PR', async () => {
  const resetPr = `https://github.com/${ONBOARDED}/pull/30`;
  const sent = serve(sample, { body: { error: null, prUrl: resetPr, board: { ...sample, repos: sample.repos.slice(1) } } });
  await openReset(sample, ONBOARDED);
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe(`Reset ${ONBOARDED}?`);
  expect([...dialog()!.querySelectorAll('#reset-detail li')].map(text)).toEqual([
    'opens a PR that removes .lar-factory.json, the ## Agent skills block and the docs/agents/ files;',
    `drops ${ONBOARDED} from this Mac's list and hides its items;`,
    `makes others who onboarded ${ONBOARDED} lose its Repository config once the PR merges.`,
  ]);
  expect(text(dialog()!.querySelector('#reset-detail'))).toMatch(/It leaves alone the T3 project and the labels and statuses on its items\.$/);
  await settle(() => button(dialog()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(sent).toEqual([{ repo: ONBOARDED }]);
  expect(dialog()).toBeNull();
  expect(row(ONBOARDED)).toBeNull();
  expect(text(toast()!)).toContain(`Opened ${ONBOARDED}'s reset PR.`);
  expect(toast()!.querySelector('a')!.getAttribute('href')).toBe(resetPr);
});

test('Reset of an onboarded repository with an open Edit PR says it closes that PR first, and links it; one without says nothing of it', async () => {
  const edit = `https://github.com/${ONBOARDED}/pull/9`;
  const data: BoardData = { ...sample, repos: [{ ...sample.repos[0]!, editPr: edit }, ...sample.repos.slice(1)] };
  serve(data);
  await openReset(data, ONBOARDED);
  const line = dialog()!.querySelector('[data-closes-edit-pr]')!;
  expect(text(line)).toBe(`closes its open Edit PR, ${ONBOARDED}#9, so it can't bring .lar-factory.json back;`);
  expect(line.querySelector('a')!.getAttribute('href')).toBe(edit);
  expect(document.activeElement, 'focus starts on Cancel, not the Edit PR link').toBe(button(dialog()!, 'Cancel'));
  await settle(() => button(dialog()!, 'Cancel').click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => button(row(sample.repos[1]!.repo)!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()!.querySelector('[data-closes-edit-pr]')).toBeNull();
});

test("a Reset of an onboarded repository whose PR gh can't open keeps the confirmation open with gh's message, and the row", async () => {
  serve(sample, { status: 502, body: { error: `Can't open ${ONBOARDED}'s reset PR: HTTP 403` } });
  await openReset(sample, ONBOARDED);
  await settle(() => button(dialog()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(`Can't resetCan't open ${ONBOARDED}'s reset PR: HTTP 403`);
  await settle(() => button(dialog()!, 'Cancel').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(row(ONBOARDED), 'Settings comes back with the row').not.toBeNull();
});

test("a Reset that closed the Edit PR but can't open the reset PR drops that Edit PR from the confirmation and the row", async () => {
  const edit = `https://github.com/${ONBOARDED}/pull/9`;
  const data: BoardData = { ...sample, repos: [{ ...sample.repos[0]!, editPr: edit }, ...sample.repos.slice(1)] };
  const error = `Can't open ${ONBOARDED}'s reset PR: HTTP 403. Its Edit PR, ${edit}, is closed now.`;
  serve(data, { status: 502, body: { error, board: sample } });
  await openReset(data, ONBOARDED);
  await settle(() => button(dialog()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(`Can't reset${error}`);
  expect(dialog()!.querySelector('[data-closes-edit-pr]')).toBeNull();
  await settle(() => button(dialog()!, 'Cancel').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(row(ONBOARDED)!.querySelector('[data-edit-pr]')).toBeNull();
});

test("Reset of an Azure DevOps onboarding says it abandons the PR and leaves the project's tags", async () => {
  const azure = 'contoso/Fabrikam%20Fiber/lar-api';
  const prUrl = 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-api/pullrequest/7';
  const data: BoardData = { ...sample, onboarding: [{ repo: azure, progress: { ...waiting, prUrl } }] };
  serve(data);
  await openReset(data, azure);
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Reset contoso/Fabrikam Fiber/lar-api?');
  expect(text(dialog()!.querySelector('#reset-detail'))).toMatch(
    /^Reset abandons contoso\/Fabrikam Fiber\/lar-api's onboarding PR, .+ It opens no PR, and leaves alone the T3 project and the project's tags\.$/);
});

test('Reset of an Azure DevOps onboarding with no PR yet says it has none to abandon', async () => {
  const azure = 'contoso/Fabrikam%20Fiber/lar-api';
  const data: BoardData = { ...sample, onboarding: [{ repo: azure, progress }] };
  serve(data);
  await openReset(data, azure);
  expect(text(dialog()!.querySelector('#reset-detail'))).toBe(
    "Reset drops contoso/Fabrikam Fiber/lar-api's onboarding from this Mac's list, with its Resume. It has no open PR to abandon, so it changes nothing on Azure DevOps, and leaves alone the T3 project and the project's tags.");
});

test('Reset of an onboarded Azure DevOps repository names it as Azure shows it, in the confirmation and the toast', async () => {
  const azure = 'contoso/Fabrikam%20Fiber/lar-api';
  const resetPr = 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-api/pullrequest/8';
  const data: BoardData = { ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: azure }] };
  serve(data, { body: { error: null, prUrl: resetPr, board: sample } });
  await openReset(data, azure);
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Reset contoso/Fabrikam Fiber/lar-api?');
  expect([...dialog()!.querySelectorAll('#reset-detail li')].map(text).slice(1)).toEqual([
    "drops contoso/Fabrikam Fiber/lar-api from this Mac's list and hides its items;",
    'makes others who onboarded contoso/Fabrikam Fiber/lar-api lose its Repository config once the PR merges.',
  ]);
  await settle(() => button(dialog()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(toast()!)).toContain("Opened contoso/Fabrikam Fiber/lar-api's reset PR.");
});
