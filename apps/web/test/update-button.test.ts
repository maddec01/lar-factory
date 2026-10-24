// The title bar's update button, T3 Code's update pill: in the board app it always shows, as an icon, in
// every update state. The bridge stands in for the app's preload and pushes each new update state, as the app does.

import { describe, expect, test, vi } from 'vite-plus/test';
import { $, addStylesheet, answerRestart, mountPage, settle, stubApp, titleBarHeight, updatesOff } from './support.ts';
import type { UpdateState } from '@mux-factory/shared';

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

const button = () => $<HTMLButtonElement>('.update-button');
const label = () => button()!.getAttribute('aria-label');
const disabled = () => button()!.getAttribute('aria-disabled') === 'true';
const icon = (name: string) => button()!.querySelector(`svg.lucide-${name}`);
const click = () => settle(() => button()!.click());
const toast = () => $('.toasts .toast');
const toastText = () => toast()?.textContent?.replace(/^×/, '');
// The spin's turn ends. jsdom runs no animation and has no AnimationEvent, so React listens for the prefixed name.
const turnEnds = () => settle(() => icon('refresh-cw')!.dispatchEvent(new Event('webkitAnimationIteration', { bubbles: true })));

test('a browser without the app has no update button', async () => {
  await mountPage();
  expect(button()).toBeNull();
});

test('the button is a round icon in the title bar, before Add item, with no text', async () => {
  stubBridge(idle);
  await mountPage();
  expect([...$('.title-bar-actions')!.children].map((el) => el.textContent)).toEqual(['Refreshed 20m ago', '', 'Add item', 'Settings']);
  expect(button()!.closest('.title-bar')).not.toBeNull();
  expect(button()!.classList).toContain('rounded-full');
  expect(button()!.textContent).toBe('');
});

test('an unpackaged dev app, whose updater is disabled, shows the button dimmed with the reason', async () => {
  const { bridge } = stubBridge(updatesOff);
  await mountPage();
  expect(icon('refresh-cw')).not.toBeNull();
  expect(label()).toBe('Updates unavailable: Updates work only in the packaged app.');
  expect(button()!.classList).toContain('opacity-60');
  expect(disabled()).toBe(true);
  await click();
  expect(bridge.checkForUpdate).not.toHaveBeenCalled();
});

describe.each([['up to date', idle], ['idle', { ...idle, status: 'idle' as const, checkedAt: null }]])('%s', (_name, state) => {
  test('shows the refresh icon, and clicking it checks', async () => {
    const { bridge } = stubBridge(state);
    await mountPage();
    expect(icon('refresh-cw')).not.toBeNull();
    expect(label()).toBe('Check for updates');
    expect(disabled()).toBe(false);
    await click();
    expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
  });
});

test('a check the page starts keeps the button disabled until it answers', async () => {
  const { bridge } = stubBridge(idle);
  let answer: () => void = () => {};
  bridge.checkForUpdate.mockImplementationOnce(() => new Promise((resolve) => { answer = () => resolve({ checked: true, state: idle }); }));
  await mountPage();
  await click();
  expect(disabled()).toBe(true);
  await click();
  expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
  await settle(answer);
  await turnEnds();
  expect(disabled()).toBe(false);
});

describe('checking', () => {
  test('spins the refresh icon and disables the button', async () => {
    const { bridge, push } = stubBridge(idle);
    await mountPage();
    await push(checking);
    expect(icon('refresh-cw')!.classList).toContain('motion-safe:visible-animate-spin');
    expect(label()).toBe('Checking for updates…');
    expect(disabled()).toBe(true);
    await click();
    expect(bridge.checkForUpdate).not.toHaveBeenCalled();
  });

  test('a background check with a downloaded update spins too', async () => {
    const { bridge, push } = stubBridge(downloaded);
    await mountPage();
    await push({ ...downloaded, status: 'checking', canRetry: false });
    expect(icon('refresh-cw')!.classList).toContain('motion-safe:visible-animate-spin');
    expect(disabled()).toBe(true);
    await click();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
  });

  test('keeps the refresh icon until its turn ends, then shows the found update', async () => {
    const { push } = stubBridge(idle);
    await mountPage();
    await push(checking);
    await push(available);
    // The spin finishes its turn before the icon changes, as in T3.
    expect(icon('refresh-cw')).not.toBeNull();
    await turnEnds();
    expect(icon('download')).not.toBeNull();
  });
});

describe('available', () => {
  test('shows the download icon with a dot, and clicking it downloads', async () => {
    const { bridge } = stubBridge(available);
    await mountPage();
    expect(icon('download')!.nextElementSibling!.classList).toContain('rounded-full');
    expect(label()).toBe('Update 1.1.0 ready to download');
    await click();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
  });

  test('a failed download looks available again and retries the download', async () => {
    const { bridge } = stubBridge(downloadFailed);
    await mountPage();
    expect(icon('download')).not.toBeNull();
    expect(label()).toBe('Update 1.1.0 ready to download');
    await click();
    expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
  });

  test('a download call that fails keeps the update to download, and T3\'s toast says so', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockRejectedValueOnce(new Error('bridge gone'));
    await mountPage();
    await click();
    expect(icon('download')).not.toBeNull();
    expect(disabled()).toBe(false);
    expect(toastText()).toBe('Could not start update download bridge gone');
    expect(toast()!.getAttribute('role')).toBe('alert');
    expect(toast()!.dataset.tone, 'T3\'s error toast: a red dot').toBe('error');
  });

  test('a download that fails returns to available, and T3\'s toast gives the reason', async () => {
    const { bridge, push } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloadFailed });
    await mountPage();
    await click();
    await push(downloadFailed);
    expect(icon('download')).not.toBeNull();
    expect(label()).toBe('Update 1.1.0 ready to download');
    expect(disabled()).toBe(false);
    expect(toastText()).toBe('Could not download update net::ERR_TIMED_OUT');
  });

  test('a download that completes shows T3\'s downloaded toast', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: true, completed: true, state: downloaded });
    await mountPage();
    await click();
    expect(toastText()).toBe('Update downloaded Restart the app from the update button to install it.');
    expect(toast()!.getAttribute('role')).toBe('status');
    expect(toast()!.dataset.tone).toBeUndefined();
  });
});

test('downloading fills a ring with the percent and disables the button', async () => {
  const { bridge, push } = stubBridge(available);
  await mountPage();
  await push(downloading);
  const ring = button()!.querySelectorAll('circle')[1]!;
  const circumference = 2 * Math.PI * 14;
  expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(circumference * (1 - 0.424));
  expect(icon('download')).not.toBeNull();
  expect(label()).toBe('Downloading update (42%)');
  expect(disabled()).toBe(true);
  await click();
  expect(bridge.downloadUpdate).not.toHaveBeenCalled();
});

describe('downloaded', () => {
  test('shows the restart icon with a check, and clicking it asks to restart, then installs on Restart', async () => {
    const { bridge } = stubBridge(downloaded);
    await mountPage();
    expect(icon('rotate-cw')).not.toBeNull();
    expect(button()!.querySelector('svg.lucide-check')).not.toBeNull();
    expect(label()).toBe('Update 1.1.0 downloaded. Click to restart and install.');
    await click();
    expect(bridge.confirmRestart).toHaveBeenCalledExactlyOnceWith('The board app will restart to install 1.1.0.');
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('Cancel leaves the update downloaded, to install later', async () => {
    const { bridge } = stubBridge(downloaded, false);
    await mountPage();
    await click();
    expect(bridge.confirmRestart).toHaveBeenCalledOnce();
    expect(bridge.installUpdate).not.toHaveBeenCalled();
    expect(icon('rotate-cw')).not.toBeNull();
    expect(label()).toBe('Update 1.1.0 downloaded. Click to restart and install.');
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

  test('a failed install looks downloaded again and retries the install', async () => {
    const { bridge } = stubBridge(installFailed);
    await mountPage();
    expect(icon('rotate-cw')).not.toBeNull();
    await click();
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('an install that fails returns to downloaded, and T3\'s toast gives the reason', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: installFailed });
    await mountPage();
    await click();
    expect(icon('rotate-cw')).not.toBeNull();
    expect(label()).toBe('Update 1.1.0 downloaded. Click to restart and install.');
    expect(disabled()).toBe(false);
    expect(toastText()).toBe('Could not install update quit refused');
    expect(toast()!.getAttribute('role')).toBe('alert');
  });

  test('an install call that fails shows T3\'s toast', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.installUpdate.mockRejectedValueOnce(new Error('bridge gone'));
    await mountPage();
    await click();
    expect(label()).toBe('Update 1.1.0 downloaded. Click to restart and install.');
    expect(toastText()).toBe('Could not install update bridge gone');
  });
});

describe('a check the page starts', () => {
  test('that the app doesn\'t run shows T3\'s toast with the reason', async () => {
    const { bridge } = stubBridge(idle);
    bridge.checkForUpdate.mockResolvedValueOnce({ checked: false, state: { ...idle, message: 'A download is running.' } });
    await mountPage();
    await click();
    expect(toastText()).toBe('Could not check for updates A download is running.');
  });

  test('whose call fails shows T3\'s toast', async () => {
    const { bridge } = stubBridge(idle);
    bridge.checkForUpdate.mockRejectedValueOnce(new Error('bridge gone'));
    await mountPage();
    await click();
    expect(toastText()).toBe('Could not check for updates bridge gone');
  });
});

test('a failed check shows T3\'s tooltip, and clicking it checks again', async () => {
  const { bridge } = stubBridge(checkFailed);
  await mountPage();
  expect(icon('refresh-cw')).not.toBeNull();
  expect(label()).toBe('Check for updates');
  await click();
  expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
});

describe('installing', () => {
  test('keeps the downloaded look, disabled, from the click until the app quits', async () => {
    const { bridge } = stubBridge(downloaded);
    // The app drains the board server, then quits: the call never answers.
    bridge.installUpdate.mockImplementation(() => new Promise(() => {}));
    await mountPage();
    await click();
    expect(icon('rotate-cw')).not.toBeNull();
    expect(label()).toBe('Installing…');
    expect(disabled()).toBe(true);
    await click();
    expect(bridge.installUpdate).toHaveBeenCalledOnce();
  });

  test('a failed install the app pushes later ends it, and clicking retries', async () => {
    const { bridge, push } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: true, completed: false, state: downloaded });
    await mountPage();
    await click();
    expect(label()).toBe('Installing…');
    await push(installFailed);
    expect(label()).toBe('Update 1.1.0 downloaded. Click to restart and install.');
    await click();
    expect(bridge.installUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('an action the app refuses, as a check runs', () => {
  test('an install shows T3\'s not-accepted toast and stays downloaded', async () => {
    const { bridge } = stubBridge(downloaded);
    bridge.installUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: downloaded });
    await mountPage();
    await click();
    expect(toastText()).toBe('Update downloaded Restart the app from the update button to install it.');
    expect(label()).toBe('Update 1.1.0 downloaded. Click to restart and install.');
    expect(disabled()).toBe(false);
  });

  test('a download shows the not-accepted toast and stays available', async () => {
    const { bridge } = stubBridge(available);
    bridge.downloadUpdate.mockResolvedValueOnce({ accepted: false, completed: false, state: available });
    await mountPage();
    await click();
    expect(toastText()).toBe('Update not downloaded Download it from the update button once the updater is free.');
    expect(label()).toBe('Update 1.1.0 ready to download');
    expect(disabled()).toBe(false);
  });
});

describe('the tooltip', () => {
  const tooltip = () => $('.update-tooltip');

  test('opens on hover with the button\'s state', async () => {
    stubBridge(available);
    await mountPage();
    // Base UI reads the pointer's type from React's pointerenter, which listens for pointerover, then opens once the mouse rests.
    await settle(() => button()!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    await settle(() => button()!.dispatchEvent(new MouseEvent('mouseenter')));
    await settle(() => button()!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })));
    await settle(() => vi.advanceTimersByTime(1000));
    expect(tooltip()!.textContent).toBe('Update 1.1.0 ready to download');
  });

  test('shows the reason updates are unavailable under its title', async () => {
    stubBridge(updatesOff);
    await mountPage();
    await settle(() => button()!.focus());
    await settle(() => vi.advanceTimersByTime(1000));
    expect(tooltip()!.textContent).toBe('Updates unavailableUpdates work only in the packaged app.');
  });

  test('opens below the title bar', async () => {
    stubBridge(available);
    await mountPage();
    // jsdom has no layout: the bar is 52 px tall, and the 32 px button sits in its middle, 10 px to 42 px down.
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    vi.spyOn($('.title-bar')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, titleBarHeight()));
    vi.spyOn(button()!, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 10, 32, 32));
    await settle(() => button()!.focus());
    await settle(() => vi.advanceTimersByTime(1000));
    const positioner = tooltip()!.parentElement!;
    const top = Number(/translate\([^,]+, ([\d.]+)px\)/.exec(positioner.style.transform)![1]);
    expect(top).toBe(titleBarHeight() + 4);
  });
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

  test.each(['latest', 'nightly'] as const)('opens on hover on %s with each Release\'s changes, and closes when the pointer leaves', async (channel) => {
    stubBridge({ ...withNotes, channel });
    await mountPage();
    expect(notes()).toBeNull();
    await hover(button()!);
    expect(notes()!.querySelector('.update-notes-title')!.textContent).toBe('Update 1.1.0 ready to download');
    expect([...notes()!.querySelectorAll('h3')].map((h) => h.textContent)).toEqual(['What\'s changed', 'Changes in 1.0.1']);
    expect([...notes()!.querySelectorAll('section:first-of-type li')].map((li) => li.textContent))
      .toEqual(['feat(board): show the changelog', 'fix(board): keep the header steady']);
    expect(notes()!.textContent).toContain('10 more changes in this Release');
    expect(notes()!.textContent).toContain('3 older Releases not shown');
    expect(button()!.getAttribute('aria-describedby')).toBe(notes()!.id);
    await unhover(button()!.parentElement!);
    expect(notes()).toBeNull();
  });

  test('opens below the button', async () => {
    stubBridge(withNotes);
    await mountPage();
    await hover(button()!);
    expect(notes()!.closest('[data-side]')!.getAttribute('data-side')).toBe('bottom');
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

  test('a check, which has no update to show, shows no changelog', async () => {
    const { push } = stubBridge(downloaded);
    await mountPage();
    await push({ ...downloaded, status: 'checking', releaseNotes: withNotes.releaseNotes });
    await hover(button()!);
    expect(notes()).toBeNull();
  });

  test('opens below the title bar, bridged to the button, and drags nothing', async () => {
    stubBridge(withNotes);
    await mountPage();
    const { noDrag } = addStylesheet();
    // jsdom has no layout: the bar is 52 px tall, and the button sits in its middle, 14 px to 38 px down.
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(800);
    const bar = $('.title-bar')!;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, titleBarHeight()));
    vi.spyOn(button()!, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 14, 80, 24));
    await hover(button()!);
    await settle(() => vi.advanceTimersByTime(50));
    const top = Number(/translate\([^,]+, ([\d.]+)px\)/.exec($('.update-notes-positioner')!.style.transform)![1]);
    expect(top).toBeGreaterThanOrEqual(titleBarHeight());
    // The pointer crosses the whole gap from the button's bottom on the changelog's bridge.
    expect(notes()!.style.getPropertyValue('--update-notes-gap')).toBe(`${top - 38}px`);
    expect(noDrag(notes()!)).toBe(true);
    // A resize that moves the button while the changelog is open measures again, so the gap stays bridged.
    vi.spyOn(button()!, 'getBoundingClientRect').mockReturnValue(new DOMRect(900, 20, 80, 24));
    await settle(() => dispatchEvent(new Event('resize')));
    await settle(() => vi.advanceTimersByTime(50));
    expect(notes()!.style.getPropertyValue('--update-notes-gap')).toBe(`${titleBarHeight() + 4 - 44}px`);
  });
});
