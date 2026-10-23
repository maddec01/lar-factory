// The header's update button, shown only in the packaged app once its updater finds a newer Release.
// The bridge stands in for the app's preload and pushes each new update state, as the app does.

import { describe, expect, test, vi } from 'vite-plus/test';
import { $, mountPage, settle, stubApp, updatesOff } from './support.ts';
import type { UpdateState } from '../../src/app/board-app.ts';

const idle: UpdateState = {
  enabled: true, status: 'up-to-date', channel: 'latest', currentVersion: '1.0.0', availableVersion: null,
  downloadedVersion: null, releaseNotes: [], omittedReleaseCount: 0, downloadPercent: null, checkedAt: '2026-10-21T09:00:00Z',
  message: null, errorContext: null, canRetry: false,
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

describe('a check with an update found', () => {
  // The app checks every 4 minutes; the state keeps the found update, its notes and a failed download's error.
  test('keeps showing the update to download', async () => {
    const { bridge, push } = stubBridge(available);
    await mountPage();
    await push({ ...available, status: 'checking' });
    expect(button()!.textContent).toBe('Update to 1.1.0');
    await settle(() => button()!.click());
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
  });

  test('keeps showing Install and restart', async () => {
    const { push } = stubBridge(downloaded);
    await mountPage();
    await push({ ...downloaded, status: 'checking', canRetry: false });
    expect(button()!.textContent).toBe('Install and restart');
  });

  test('keeps showing a failed download and its retry', async () => {
    const { push } = stubBridge(downloadFailed);
    await mountPage();
    await push({ ...downloadFailed, status: 'checking' });
    expect(button()!.textContent).toBe('Update failed, retry');
    expect(button()!.title).toBe('Couldn\'t download 1.1.0: net::ERR_TIMED_OUT');
  });
});

describe('installing', () => {
  test('shows Installing from the click until the app quits, and ignores a second click', async () => {
    const { bridge } = stubBridge(downloaded);
    // The app drains the board server, then quits: the call never answers.
    bridge.installUpdate.mockImplementation(() => new Promise(() => {}));
    await mountPage();
    await settle(() => button()!.click());
    expect(button()!.textContent).toBe('Installing…');
    expect(button()!.getAttribute('aria-disabled')).toBe('true');
    await settle(() => button()!.click());
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('a failed install answered by the call shows the error and its retry', async () => {
    const { bridge, push } = stubBridge(downloaded);
    // The app pushes the failed state, then answers the call with it.
    bridge.installUpdate.mockImplementationOnce(async () => {
      await push(installFailed);
      return { accepted: true, completed: false, state: installFailed };
    });
    await mountPage();
    await settle(() => button()!.click());
    expect(button()!.textContent).toBe('Update failed, retry');
  });

  test('a failed install the app pushes later, after quitting failed, shows the error and its retry', async () => {
    const { bridge, push } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloaded });
    await mountPage();
    await settle(() => button()!.click());
    expect(button()!.textContent).toBe('Installing…');
    await push(installFailed);
    expect(button()!.textContent).toBe('Update failed, retry');
    await settle(() => button()!.click());
    expect(bridge.installUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('an action the app refuses, as a check runs', () => {
  const busy = 'The updater is busy. Try again in a moment.';

  test('an install says so, until the next state', async () => {
    const { bridge, push } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: downloaded });
    await mountPage();
    await settle(() => button()!.click());
    expect(button()!.textContent).toBe('Install and restart');
    expect(button()!.title).toBe(busy);
    await push(downloaded);
    expect(button()!.title).toBe('Quits and opens 1.1.0.');
  });

  test('a download says so, until the next click', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: available });
    await mountPage();
    await settle(() => button()!.click());
    expect(button()!.textContent).toBe('Update to 1.1.0');
    expect(button()!.title).toBe(busy);
    bridge.downloadUpdate.mockImplementationOnce(() => new Promise(() => {}));
    await settle(() => button()!.click());
    expect(button()!.title).toBe('');
  });
});

test('a download call that fails keeps the update to download', async () => {
  const { bridge } = stubBridge(available);
  bridge.downloadUpdate.mockRejectedValueOnce(new Error('bridge gone'));
  await mountPage();
  await settle(() => button()!.click());
  expect(button()!.textContent).toBe('Update to 1.1.0');
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

test('a retried install, answered while the app quits, shows Installing and no old error', async () => {
  const { bridge, push } = stubBridge(installFailed);
  // The app clears the old failure as the retry starts, then answers while it drains and quits.
  bridge.installUpdate.mockImplementationOnce(async () => {
    await push(downloaded);
    return { accepted: true, completed: false, state: downloaded };
  });
  await mountPage();
  await settle(() => button()!.click());
  expect(button()!.textContent).toBe('Installing…');
  expect(button()!.dataset.tone).toBeUndefined();
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

describe('the changelog', () => {
  const withNotes: UpdateState = {
    ...available,
    releaseNotes: [
      { version: '1.1.0', items: ['feat(board): show the changelog', 'fix(board): keep the header steady'], totalItems: 2 },
      { version: '1.0.1', items: ['fix(board): retry a failed download'], totalItems: 11 },
    ],
    omittedReleaseCount: 3,
  };
  const pointer = (type: string, el: Element) =>
    settle(() => el.dispatchEvent(new PointerEvent(type, { bubbles: type !== 'pointerenter' && type !== 'pointerleave', pointerType: 'mouse' })));
  const hover = (el: Element) => pointer('pointerover', el).then(() => pointer('pointerenter', el));
  const unhover = (el: Element) => pointer('pointerout', el).then(() => pointer('pointerleave', el));
  const notes = () => $('.update-notes');

  test('opens on hover with each Release\'s changes, and closes when the pointer leaves', async () => {
    stubBridge(withNotes);
    await mountPage();
    expect(notes()).toBeNull();
    await hover(button()!);
    expect([...notes()!.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['What\'s changed', 'Changes in 1.0.1']);
    expect([...notes()!.querySelectorAll('section:first-of-type li')].map((li) => li.textContent))
      .toEqual(['feat(board): show the changelog', 'fix(board): keep the header steady']);
    expect(notes()!.textContent).toContain('10 more changes in this Release');
    expect(notes()!.textContent).toContain('3 older Releases not shown');
    expect(button()!.getAttribute('aria-describedby')).toBe(notes()!.id);
    await unhover(button()!.parentElement!);
    expect(notes()).toBeNull();
  });

  test('opens on keyboard focus and closes on blur', async () => {
    stubBridge(withNotes);
    await mountPage();
    await settle(() => button()!.focus());
    expect(notes()).not.toBeNull();
    expect(document.activeElement).toBe(button());
    await settle(() => button()!.blur());
    expect(notes()).toBeNull();
  });

  test('Tab goes from the update button, its changelog open, straight to Add item', async () => {
    stubBridge(withNotes);
    await mountPage();
    await settle(() => button()!.focus());
    expect(notes()).not.toBeNull();
    // jsdom doesn't move focus on Tab, so this reads the tab order: the focusable elements in the page's order.
    const tabbable = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled);
    const next = tabbable[tabbable.indexOf(button()!) + 1];
    expect(next?.textContent).toBe('Add item');
  });

  test('an update without notes shows no changelog', async () => {
    stubBridge(available);
    await mountPage();
    await hover(button()!);
    expect(notes()).toBeNull();
  });

  test('shows the error of a failed install above the changelog, in place of the tooltip', async () => {
    stubBridge({ ...installFailed, releaseNotes: withNotes.releaseNotes });
    await mountPage();
    expect(button()!.title).toBe('');
    await hover(button()!);
    expect(notes()!.querySelector('p')!.textContent).toBe('Couldn\'t install 1.1.0: quit refused');
  });
});
