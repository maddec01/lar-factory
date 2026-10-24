// In the board app the page sends the per-launch secret from the preload bridge with each write;
// outside it (a browser, `pnpm run sample`) it sends no secret header.

import { expect, test, vi } from 'vite-plus/test';
import { $, fetchMock, mountPage, settle, stubApp } from '../test/support.ts';

const secretOfLastPost = () => {
  const [, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
  return new Headers(init.headers).get('X-Board-Secret');
};

async function queueFirstItem(): Promise<void> {
  await mountPage();
  await settle(() => $<HTMLButtonElement>('[data-queue="PVTI_sample01"]')!.click());
}

test('in the app, a write carries the secret the bridge holds', async () => {
  stubApp({ secret: 'launch-secret' });
  await queueFirstItem();
  expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/queue');
  expect(secretOfLastPost()).toBe('launch-secret');
});

test('outside the app, a write carries no secret header', async () => {
  await queueFirstItem();
  expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/queue');
  expect(secretOfLastPost()).toBeNull();
});

test('a bridge without a secret adds no header', async () => {
  stubApp({});
  await queueFirstItem();
  expect(secretOfLastPost()).toBeNull();
});
