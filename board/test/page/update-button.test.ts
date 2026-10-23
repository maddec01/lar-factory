// The header's update button, shown only in the packaged app once its updater finds a newer Release.
// The bridge stands in for the app's preload and pushes each new update state, as the app does.

import { expect, test, vi } from 'vite-plus/test';
import { $, mountPage, settle, stubApp, updatesOff } from './support.ts';
import type { UpdateState } from '../../src/app/board-app.ts';

const idle: UpdateState = {
  enabled: true, status: 'up-to-date', channel: 'latest', currentVersion: '1.0.0', availableVersion: null,
  downloadedVersion: null, downloadPercent: null, checkedAt: '2026-10-21T09:00:00Z', message: null,
  errorContext: null, canRetry: false,
};
const available: UpdateState = { ...idle, status: 'available', availableVersion: '1.1.0' };
const downloading: UpdateState = { ...available, status: 'downloading', downloadPercent: 42.4 };
const downloaded: UpdateState = { ...available, status: 'downloaded', downloadedVersion: '1.1.0', downloadPercent: 100, canRetry: true };
// The states the app's reducers give a failed download and a failed install: the update stays available or downloaded.
const downloadFailed: UpdateState = { ...available, errorContext: 'download', canRetry: true, message: 'net::ERR_TIMED_OUT' };
const installFailed: UpdateState = { ...downloaded, errorContext: 'install', message: 'quit refused' };

function stubBridge(start: UpdateState) {
  let push: (state: UpdateState) => void = () => {};
  const action = (state: UpdateState) => vi.fn(async () => ({ accepted: true, completed: false, state }));
  const bridge = stubApp({
    getUpdateState: vi.fn(async () => start),
    onUpdateState: vi.fn((listener: (state: UpdateState) => void) => { push = listener; return () => {}; }),
    downloadUpdate: action(downloading),
    installUpdate: action(downloaded),
  });
  return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
}

const button = () => $<HTMLButtonElement>('.update-button');

test('a browser without the app has no update button', async () => {
  await mountPage();
  expect(button()).toBeNull();
});

test('no update, no button', async () => {
  stubBridge(idle);
  await mountPage();
  expect(button()).toBeNull();
});

test('an unpackaged dev app, whose updater is disabled, has no button', async () => {
  stubBridge(updatesOff);
  await mountPage();
  expect(button()).toBeNull();
});

test('an available update shows the button in the header, and clicking it downloads', async () => {
  const { bridge } = stubBridge(available);
  await mountPage();
  expect(button()!.closest('header.top')).not.toBeNull();
  expect(button()!.textContent).toBe('Update to 1.1.0');
  await settle(() => button()!.click());
  expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
});

test('the button follows the pushed states: progress while downloading, then Install and restart', async () => {
  const { bridge, push } = stubBridge(idle);
  await mountPage();
  await push(available);
  expect(button()!.textContent).toBe('Update to 1.1.0');

  await push(downloading);
  expect(button()!.textContent).toBe('Downloading 42%');
  expect(button()!.getAttribute('aria-disabled')).toBe('true');
  await settle(() => button()!.click());
  expect(bridge.downloadUpdate).not.toHaveBeenCalled();

  await push(downloaded);
  expect(button()!.textContent).toBe('Install and restart');
  await settle(() => button()!.click());
  expect(bridge.installUpdate).toHaveBeenCalledOnce();
});

test('a failed download shows the error and retries the download', async () => {
  const { bridge } = stubBridge(downloadFailed);
  await mountPage();
  expect(button()!.textContent).toBe('Update failed, retry');
  expect(button()!.title).toBe('Couldn\'t download 1.1.0: net::ERR_TIMED_OUT');
  expect(button()!.dataset.tone).toBe('error');
  await settle(() => button()!.click());
  expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
});

test('a failed install retries the install', async () => {
  const { bridge } = stubBridge(installFailed);
  await mountPage();
  expect(button()!.textContent).toBe('Update failed, retry');
  expect(button()!.title).toBe('Couldn\'t install 1.1.0: quit refused');
  await settle(() => button()!.click());
  expect(bridge.installUpdate).toHaveBeenCalledOnce();
});

test('a failed check, with no update known, shows no button', async () => {
  stubBridge({ ...idle, status: 'error', errorContext: 'check', canRetry: true, message: 'offline' });
  await mountPage();
  expect(button()).toBeNull();
});
