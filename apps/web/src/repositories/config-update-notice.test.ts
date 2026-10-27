// The config update notice in Settings › Repositories: a repository whose .lar-factory.json is below the app's version
// shows it with both versions, Open PR posts the repository and the board sent back drops the notice and marks the Edit
// PR, Dismiss posts it too, and a call that fails keeps the notice with gh's message.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';

const PR = 'https://github.com/maddec01/lar-server/pull/22';
const repo = sample.repos[0]!.repo;
const outdated: BoardData = { ...sample, repos: [{ ...sample.repos[0]!, version: 1, configUpdate: 2 }, sample.repos[1]!] };

type Answer = { status?: number; body: object };

/** Serves `data` as the board and `answer` for the notice's calls, and returns each call's path and body. */
function serve(data: BoardData, answer: Answer) {
  const sent: [string, object][] = [];
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/repositories/config-update/')) return new Response(JSON.stringify(data));
    sent.push([url, JSON.parse(String(init?.body))]);
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  }) as typeof fetchMock);
  return sent;
}

const row = (name = repo) => $(`.settings-row[data-row="repo-${name}"]`)!;
const notice = (name = repo) => row(name).querySelector('[data-config-update]');
const button = (label: string) => [...notice()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!;

async function openRepositories(data: BoardData): Promise<void> {
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Repositories')!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

test('a repository below the app version shows the notice with both versions; one at it shows none', async () => {
  serve(outdated, { body: { error: null } });
  await openRepositories(outdated);
  expect(text(notice()!.querySelector('[data-slot="description"]'))).toBe('Its .lar-factory.json is at version 1, and Lar Factory now writes version 2. The board reads the '
    + 'older file with defaults. The PR rewrites the file with the same values at version 2.');
  expect(notice(sample.repos[1]!.repo)).toBeNull();
  expect(notice()!.parentElement, 'across the row, under the name and controls').toBe(row());
});

test('Open PR posts the repository, and the board sent back drops the notice and shows the Edit PR', async () => {
  const sent = serve(outdated, { body: { error: null, prUrl: PR, board: { ...sample, repos: [{ ...sample.repos[0]!, version: 1, editPr: PR }, sample.repos[1]!] } } });
  await openRepositories(outdated);
  await settle(() => button('Open PR').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(sent).toEqual([['/api/repositories/config-update/pr', { repo }]]);
  expect(notice()).toBeNull();
  expect(row().querySelector('a[data-edit-pr]')!.getAttribute('href')).toBe(PR);
});

test('Dismiss posts the repository, and the board sent back drops the notice', async () => {
  const sent = serve(outdated, { body: { error: null, board: sample } });
  await openRepositories(outdated);
  await settle(() => button('Dismiss').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(sent).toEqual([['/api/repositories/config-update/dismiss', { repo }]]);
  expect(notice()).toBeNull();
});

test("a PR gh can't open keeps the notice, with gh's message", async () => {
  serve(outdated, { status: 502, body: { error: `Can't open ${repo}'s Edit PR: HTTP 403` } });
  await openRepositories(outdated);
  await settle(() => button('Open PR').click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(notice()!.querySelector('[role="alert"]'))).toBe(`Can't open ${repo}'s Edit PR: HTTP 403`);
  expect(button('Open PR').disabled).toBe(false);
});
