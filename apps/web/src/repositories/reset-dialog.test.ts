// Reset in Settings › Repositories on a repository still onboarding: the confirmation says whether it closes the
// onboarding PR or only drops the onboarding, Reset posts the repository and the board drops its row and card, and a
// close gh refuses keeps the confirmation open with gh's message.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
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
    if (url !== '/api/onboarding/reset') return new Response(JSON.stringify(data));
    sent.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reset.body), { status: reset.status ?? 200 });
  }) as typeof fetchMock);
  return sent;
}

const dialog = () => $('[data-reset-dialog]');
const row = () => $(`.settings-row[data-row="repo-${REPO}"]`);
const button = (within: Element, label: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!;

/** Opens Settings › Repositories on `data` and presses the onboarding's Reset. */
async function openReset(data: BoardData): Promise<void> {
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  await settle(() => button(row()!, 'Reset').click());
  await settle(() => vi.advanceTimersByTime(50));
}

test('Reset of an onboarding waiting for its PR says it closes the PR, then closes it and drops the row and the card', async () => {
  const data: BoardData = { ...sample, onboarding: [{ repo: REPO, progress: waiting }] };
  const sent = serve(data);
  await openReset(data);
  expect(text(dialog()!.querySelector('[data-slot="alert-dialog-title"]'))).toBe(`Reset ${REPO}?`);
  expect(text(dialog()!.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
    `Reset closes ${REPO}’s onboarding PR, maddec01/lar-web#14, and drops its onboarding from this Mac’s list, with its Resume. It opens no PR, and leaves alone the T3 project and the repository’s labels.`);
  expect(dialog()!.querySelector('[data-slot="alert-dialog-description"] a')!.getAttribute('href')).toBe(PR);
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
  expect(text(dialog()!.querySelector('[data-slot="alert-dialog-description"]'))).toBe(
    `Reset drops ${REPO}’s onboarding from this Mac’s list, with its Resume. It has no open PR to close, so it changes nothing on GitHub, and leaves alone the T3 project and the repository’s labels.`);
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
  expect(text(dialog()!.querySelector('[data-slot="alert"]'))).toBe(`Can’t resetCan't close ${REPO}'s onboarding PR: HTTP 403: Resource not accessible`);
  expect(row()).not.toBeNull();
  expect(button(dialog()!, 'Reset').disabled).toBe(false);
});
