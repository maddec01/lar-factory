// The title bar's update pill: hidden with no update, then "Update available", a progress ring with the percentage
// while it downloads, and "Restart to update" once downloaded. Hovering it shows the changelog with the next step's
// button. The bridge stands in for the app's preload and pushes each new update state, as the app does.

import { describe, expect, test, vi } from 'vite-plus/test';
import { $, answerRestart, mountPage, settle, stubApp, text, toast, updatesOff } from '../../test/support.ts';
import type { UpdateState } from '@lar-factory/shared';

const idle: UpdateState = {
  enabled: true, status: 'up-to-date', channel: 'latest', currentVersion: '1.0.0', availableVersion: null,
  downloadedVersion: null, releaseNotes: [], omittedReleaseCount: 0, downloadPercent: null, checkedAt: '2026-10-21T09:00:00Z',
  message: null, errorContext: null, canRetry: false,
};
const checking: UpdateState = { ...idle, status: 'checking' };
const available: UpdateState = { ...idle, status: 'available', availableVersion: '1.1.0' };
const downloading: UpdateState = { ...available, status: 'downloading', downloadPercent: 42.4 };
const downloaded: UpdateState = { ...available, status: 'downloaded', downloadedVersion: '1.1.0', downloadPercent: 100, canRetry: true };
// The states the app's reducers give a failed check, download and install.
const checkFailed: UpdateState = { ...idle, status: 'error', errorContext: 'check', canRetry: true, message: 'offline' };
const downloadFailed: UpdateState = { ...available, errorContext: 'download', canRetry: true, message: 'net::ERR_TIMED_OUT' };
const installFailed: UpdateState = { ...downloaded, errorContext: 'install', message: 'quit refused' };
const withNotes: UpdateState = {
  ...available,
  releaseNotes: [
    { version: '1.1.0', items: ['feat(board): show the changelog', 'fix(board): keep the header steady'], totalItems: 2 },
    { version: '1.0.1', items: ['fix(board): retry a failed download'], totalItems: 11 },
  ],
  omittedReleaseCount: 3,
};

function stubBridge(start: UpdateState, restart = true) {
  let push: (state: UpdateState) => void = () => {};
  const action = (state: UpdateState) => vi.fn(async () => ({ accepted: true, completed: false, state }));
  const bridge = stubApp({
    getUpdateState: vi.fn(async () => start),
    onUpdateState: vi.fn((listener: (state: UpdateState) => void) => { push = listener; return () => {}; }),
    checkForUpdate: vi.fn(async () => ({ checked: true, state: idle })),
    downloadUpdate: action(downloading),
    installUpdate: action(downloaded),
    confirmRestart: answerRestart(restart),
  });
  return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
}

const pill = () => $<HTMLElement>('.title-bar .update-button');
const disabled = () => pill()!.getAttribute('aria-disabled') === 'true';
const icon = (name: string) => pill()!.querySelector(`svg.lucide-${name}`);
const click = () => settle(() => pill()!.click());
const toastText = () => toast()?.textContent;
const changelog = () => $('[data-slot="popover-content"]');
const changelogButton = () => changelog()!.querySelector<HTMLButtonElement>('button.update-next')!;
const pointer = (type: 'pointerover' | 'pointerout', el: Element) =>
  settle(() => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'mouse' })));
const hover = (el: Element) => pointer('pointerover', el);
const unhover = (el: Element) => pointer('pointerout', el);

test('a browser without the app has no update pill', async () => {
  await mountPage();
  expect(pill()).toBeNull();
});

describe.each([
  ['up to date', idle], ['idle', { ...idle, status: 'idle' as const, checkedAt: null }], ['checking', checking],
  ['a failed check', checkFailed], ['an unpackaged dev app', updatesOff],
])('with no update (%s)', (_name, state) => {
  test('the pill doesn\'t show', async () => {
    stubBridge(state);
    await mountPage();
    expect(pill()).toBeNull();
  });
});

describe('available', () => {
  test('a pill reads "Update available", just before Settings, and clicking it downloads', async () => {
    const { bridge } = stubBridge(available);
    await mountPage();
    expect(text(pill())).toBe('Update available');
    expect(pill()!.classList).toContain('rounded-full');
    expect(icon('arrow-down-to-line')).not.toBeNull();
    const controls = [...pill()!.closest('.title-bar')!.querySelectorAll('button')];
    expect(controls[controls.indexOf(pill() as HTMLButtonElement) + 1]!.classList, 'Settings comes right after it').toContain('open-settings');
    await click();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
  });

  test('appears when a check finds an update', async () => {
    const { push } = stubBridge(idle);
    await mountPage();
    await push(checking);
    expect(pill()).toBeNull();
    await push(available);
    expect(text(pill())).toBe('Update available');
  });

  test('a failed download is available again and retries the download', async () => {
    const { bridge } = stubBridge(downloadFailed);
    await mountPage();
    expect(text(pill())).toBe('Update available');
    await click();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
  });

  test('a download call that fails keeps the update to download, and T3\'s toast says so', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockRejectedValueOnce(new Error('bridge gone'));
    await mountPage();
    await click();
    expect(text(pill())).toBe('Update available');
    expect(disabled()).toBe(false);
    expect(toastText()).toBe('Could not start update download bridge gone');
    expect(toast()!.getAttribute('role')).toBe('alert');
  });

  test('a download that fails returns to available, and T3\'s toast gives the reason', async () => {
    const { bridge, push } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloadFailed });
    await mountPage();
    await click();
    await push(downloadFailed);
    expect(text(pill())).toBe('Update available');
    expect(toastText()).toBe('Could not download update net::ERR_TIMED_OUT');
  });

  test('a download that completes shows T3\'s downloaded toast', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: true, completed: true, state: downloaded });
    await mountPage();
    await click();
    expect(toastText()).toBe('Update downloaded Restart the app from the update button to install it.');
  });

  test('a download the app refuses shows the not-accepted toast and stays available', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: available });
    await mountPage();
    await click();
    expect(toastText()).toBe('Update not downloaded Download it from the update button once the updater is free.');
    expect(text(pill())).toBe('Update available');
  });

  test('a second click while the download call runs does nothing', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockImplementationOnce(() => new Promise(() => {}));
    await mountPage();
    await click();
    expect(disabled()).toBe(true);
    await click();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
  });
});

describe('downloading', () => {
  test('shows a progress ring filled to the percentage, with the percentage', async () => {
    const { push } = stubBridge(available);
    await mountPage();
    await push(downloading);
    const ring = pill()!.querySelectorAll('circle')[1]!;
    const circumference = 2 * Math.PI * 7;
    expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * (1 - 0.42));
    expect(text(pill())).toBe('Downloading 42%');
    expect(pill()!.tagName, 'nothing to click while it downloads').not.toBe('BUTTON');
    expect(['role', 'aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow'].map((name) => pill()!.getAttribute(name)))
      .toEqual(['progressbar', 'Downloading 1.1.0', '0', '100', '42']);
  });

  test('its tooltip names the version', async () => {
    stubBridge(downloading);
    await mountPage();
    await settle(() => pill()!.focus());
    await settle(() => vi.advanceTimersByTime(1000));
    expect(text($('[role="tooltip"]'))).toBe('Downloading 1.1.0… 42%');
  });

  test('a download with no percentage yet shows an empty ring at 0%', async () => {
    stubBridge({ ...downloading, downloadPercent: null });
    await mountPage();
    expect(text(pill())).toBe('Downloading 0%');
  });
});

describe('downloaded', () => {
  test('reads "Restart to update"; clicking it asks to restart, then installs on Restart', async () => {
    const { bridge } = stubBridge(downloaded);
    await mountPage();
    expect(text(pill())).toBe('Restart to update');
    expect(icon('rotate-ccw')).not.toBeNull();
    await click();
    expect(bridge.confirmRestart).toHaveBeenCalledExactlyOnceWith('The board app will restart to install 1.1.0.');
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('Cancel leaves the update downloaded, to install later', async () => {
    const { bridge } = stubBridge(downloaded, false);
    await mountPage();
    await click();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(text(pill())).toBe('Restart to update');
    expect(disabled()).toBe(false);
    expect(toast()).toBeNull();
  });

  test('a question the app can\'t ask shows T3\'s toast and installs nothing', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.confirmRestart.mockRejectedValueOnce(new Error('no window'));
    await mountPage();
    await click();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(toastText()).toBe('Could not confirm update no window');
    expect(disabled()).toBe(false);
  });

  test('a failed install reads "Restart to update" again and retries the install', async () => {
    const { bridge } = stubBridge(installFailed);
    await mountPage();
    expect(text(pill())).toBe('Restart to update');
    await click();
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('an install that fails returns to "Restart to update", and T3\'s toast gives the reason', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: installFailed });
    await mountPage();
    await click();
    expect(text(pill())).toBe('Restart to update');
    expect(disabled()).toBe(false);
    expect(toastText()).toBe('Could not install update quit refused');
  });

  test('an install call that fails shows T3\'s toast', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.installUpdate.mockRejectedValueOnce(new Error('bridge gone'));
    await mountPage();
    await click();
    expect(toastText()).toBe('Could not install update bridge gone');
  });

  test('an install the app refuses shows T3\'s downloaded toast and stays downloaded', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: downloaded });
    await mountPage();
    await click();
    expect(toastText()).toBe('Update downloaded Restart the app from the update button to install it.');
    expect(text(pill())).toBe('Restart to update');
    expect(disabled()).toBe(false);
  });

  test('a background check keeps the pill, disabled until it ends', async () => {
    const { bridge, push } = stubBridge(downloaded);
    await mountPage();
    await push({ ...downloaded, status: 'checking', canRetry: false });
    expect(text(pill())).toBe('Restart to update');
    expect(disabled()).toBe(true);
    await click();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });
});

describe('installing', () => {
  test('reads "Installing…", disabled, from the click until the app quits', async () => {
    const { bridge } = stubBridge(downloaded);
    // The app drains the board server, then quits: the call never answers.
    bridge.installUpdate.mockImplementation(() => new Promise(() => {}));
    await mountPage();
    await click();
    expect(text(pill())).toBe('Installing…');
    expect(disabled()).toBe(true);
    await click();
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('a failed install the app pushes later ends it, and clicking retries', async () => {
    const { bridge, push } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloaded });
    await mountPage();
    await click();
    expect(text(pill())).toBe('Installing…');
    await push(installFailed);
    expect(text(pill())).toBe('Restart to update');
    await click();
    expect(bridge.installUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('the changelog', () => {
  test('hovering "Update available" shows what changed in each Release, with Download', async () => {
    stubBridge(withNotes);
    await mountPage();
    expect(changelog()).toBeNull();
    await hover(pill()!);
    expect(text(changelog()!.querySelector('.update-heading'))).toBe('1.1.0 is available.');
    expect([...changelog()!.querySelectorAll('h3')].map(text)).toEqual(['What\'s changed', 'Changes in 1.0.1']);
    expect([...changelog()!.querySelectorAll('section:first-of-type li')].map(text))
      .toEqual(['feat(board): show the changelog', 'fix(board): keep the header steady']);
    expect(text(changelog())).toContain('10 more changes in this Release');
    expect(text(changelog())).toContain('3 older Releases not shown');
    expect(text(changelogButton())).toBe('Download');
    expect(document.activeElement, 'focus stays where it was').not.toBe(changelogButton());
  });

  test('Download starts the download', async () => {
    const { bridge, push } = stubBridge(withNotes);
    await mountPage();
    await hover(pill()!);
    await settle(() => changelogButton().click());
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    await push({ ...withNotes, ...downloading });
    expect(text(pill())).toBe('Downloading 42%');
    expect(changelog(), 'the downloading pill has no changelog').toBeNull();
  });

  test('an update without notes still shows the version and Download', async () => {
    stubBridge(available);
    await mountPage();
    await hover(pill()!);
    expect(text(changelog()!.querySelector('.update-heading'))).toBe('1.1.0 is available.');
    expect(changelog()!.querySelector('h3')).toBeNull();
    expect(text(changelogButton())).toBe('Download');
  });

  test('hovering "Restart to update" shows the changelog with Restart now, which asks to restart', async () => {
    const { bridge } = stubBridge({ ...withNotes, ...downloaded });
    await mountPage();
    await hover(pill()!);
    expect(text(changelog()!.querySelector('.update-heading'))).toBe('1.1.0 is ready to install.');
    expect(text(changelogButton())).toBe('Restart now');
    await settle(() => changelogButton().click());
    expect(bridge.confirmRestart).toHaveBeenCalledOnce();
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('closes 150 ms after the pointer leaves, unless it moves into the changelog', async () => {
    stubBridge(withNotes);
    await mountPage();
    await hover(pill()!);
    await unhover(pill()!);
    await settle(() => vi.advanceTimersByTime(100));
    await hover(changelog()!);
    await settle(() => vi.advanceTimersByTime(500));
    expect(changelog(), 'open while the pointer is on it').not.toBeNull();
    await unhover(changelog()!);
    await settle(() => vi.advanceTimersByTime(140));
    expect(changelog(), 'still open just before the delay ends').not.toBeNull();
    await settle(() => vi.advanceTimersByTime(20));
    expect(changelog()).toBeNull();
  });

  test('opens on keyboard focus, which stays on the pill, and Escape closes it', async () => {
    stubBridge(withNotes);
    await mountPage();
    // Tab pressed on the page, which jsdom's :focus-visible reads.
    await settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })));
    await settle(() => pill()!.focus());
    expect(changelog()).not.toBeNull();
    expect(document.activeElement).toBe(pill());
    await settle(() => pill()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(changelog()).toBeNull();
  });

  test('a click on the pill runs the update and leaves the changelog open', async () => {
    const { bridge } = stubBridge(withNotes);
    await mountPage();
    await hover(pill()!);
    await click();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    expect(changelog()).not.toBeNull();
  });

  test('closes when the update goes', async () => {
    const { push } = stubBridge(withNotes);
    await mountPage();
    await hover(pill()!);
    await push({ ...idle, releaseNotes: withNotes.releaseNotes });
    expect(pill()).toBeNull();
    expect(changelog()).toBeNull();
  });
});
