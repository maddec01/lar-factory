// The app's Settings dialog: the Claude profiles with their ticks, what a tick change did, and the update channel.
// The bridge stands in for the app's preload; without it the page has no Settings.

import { describe, expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, answerRestart, mountPage, settle, stubApp, titleBarHeight } from '../../test/support.ts';
import type { ProfilesResult, UpdateChannel, UpdateState } from '@mux-factory/shared';
import { INSTALL_RECHECK_MS } from './settings-store.ts';

const listed: ProfilesResult = {
  profiles: [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: false }],
  installed: true,
  conflicts: [],
};

const bothTicked: ProfilesResult = { ...listed, profiles: [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: true }] };

function stubBridge(setResult: ProfilesResult = listed) {
  return stubApp({
    listProfiles: vi.fn(async () => listed),
    setProfileTick: vi.fn(async (_name: string, _ticked: boolean) => setResult),
  });
}

const settingsButton = () => $<HTMLButtonElement>('.open-settings');
const boxes = () => $$<HTMLInputElement>('#settings-dialog input[type="checkbox"]');
const result = () => $('#settings-result')!;

async function open(): Promise<void> {
  await mountPage();
  await settle(() => settingsButton()!.click());
  await settle(() => vi.advanceTimersByTime(50));
}

const closeButton = () => [...document.querySelectorAll<HTMLButtonElement>('#settings-dialog button')].find((button) => button.textContent === 'Close')!;
const dialogText = () => $('#settings-dialog')!.textContent!;

test('a browser without the app has no Settings', async () => {
  await mountPage();
  expect(settingsButton()).toBeNull();
});

test('Settings lists every Claude profile with its tick', async () => {
  const bridge = stubBridge();
  await open();
  const popup = $('#settings-dialog')!;
  expect(popup.getAttribute('role')).toBe('dialog');
  expect(document.getElementById(popup.getAttribute('aria-labelledby')!)!.textContent).toBe('Settings');
  expect(bridge.listProfiles).toHaveBeenCalledOnce();
  expect(boxes().map((box) => [box.closest('label')!.textContent!.trim(), box.checked])).toEqual([
    ['~/.claude', true], ['~/.claude-work', false]]);
  expect(result().getAttribute('role')).toBe('status');
});

test('the dialog opens below the title bar and drags nothing', async () => {
  stubBridge();
  await open();
  const { noDrag } = addStylesheet();
  const dialog = $('#settings-dialog')!;
  expect(parseFloat(getComputedStyle(dialog).top)).toBeGreaterThanOrEqual(titleBarHeight());
  expect(noDrag(dialog)).toBe(true);
});

test('ticking a profile installs it and shows the new ticks', async () => {
  const bridge = stubBridge(bothTicked);
  await open();
  await settle(() => boxes()[1]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledWith('.claude-work', true);
  expect(boxes().map((box) => box.checked)).toEqual([true, true]);
  expect(result().textContent).toBe('Linked the skills and checklists into ~/.claude-work.');
  expect(result().dataset.tone).toBe('success');
});

test('focus stays on a ticked box while its change runs and after', async () => {
  const bridge = stubBridge();
  let finish!: (result: ProfilesResult) => void;
  bridge.setProfileTick.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  const box = boxes()[1]!;
  box.focus();
  await settle(() => box.click());
  // A browser blurs a box that turns disabled; jsdom doesn't, so check it stays enabled too.
  expect(box.matches(':disabled')).toBe(false);
  expect(document.activeElement).toBe(box);
  expect(box.getAttribute('aria-disabled')).toBe('true');
  await settle(() => boxes()[0]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledOnce();
  await settle(() => finish(bothTicked));
  expect(document.activeElement).toBe(boxes()[1]);
  expect(boxes()[1]!.getAttribute('aria-disabled')).toBe('false');
  expect(boxes().map((each) => each.checked)).toEqual([true, true]);
});

test('unticking a profile removes its links', async () => {
  const bridge = stubBridge({ ...listed, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }],
    removed: { links: ['tdd'], checklists: true } });
  await open();
  await settle(() => boxes()[0]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledWith('.claude', false);
  expect(boxes()[0]!.checked).toBe(false);
  expect(result().textContent).toBe('Removed the skill links and checklists from ~/.claude.');
});

test('unticking says only what it removed', async () => {
  const bridge = stubBridge({ ...bothTicked, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: true }],
    removed: { links: ['tdd'], checklists: false } });
  bridge.listProfiles.mockResolvedValueOnce(bothTicked);
  await open();
  await settle(() => boxes()[0]!.click());
  expect(result().textContent).toBe('Removed the skill links from ~/.claude.');

  bridge.setProfileTick.mockResolvedValueOnce({ ...listed, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }],
    removed: { links: [], checklists: false } });
  await settle(() => boxes()[1]!.click());
  expect(bridge.setProfileTick).toHaveBeenLastCalledWith('.claude-work', false);
  expect(result().textContent).toBe('Mux Factory had no skill links or checklists in ~/.claude-work to remove.');
});

test('a tick that left paths alone names each one', async () => {
  stubBridge({ ...bothTicked, conflicts: ['~/.claude-work/skills/mux-work'] });
  await open();
  await settle(() => boxes()[1]!.click());
  expect(result().textContent).toContain('left these alone because Mux Factory didn\'t make them');
  expect($$('#settings-result li').map((li) => li.textContent)).toEqual(['~/.claude-work/skills/mux-work']);
  expect(result().dataset.tone).toBe('warning');
});

test('a failed tick shows its error and keeps the old ticks', async () => {
  stubBridge({ ...listed, error: 'No skills are installed in /Users/me/.agents yet' });
  await open();
  await settle(() => boxes()[1]!.click());
  expect(boxes().map((box) => box.checked)).toEqual([true, false]);
  expect(result().textContent).toBe('Couldn\'t change ~/.claude-work: No skills are installed in /Users/me/.agents yet');
  expect(result().dataset.tone).toBe('error');
});

test('a bridge that throws shows the error', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockRejectedValueOnce(new Error('home is gone'));
  await open();
  expect(boxes()).toEqual([]);
  expect(result().textContent).toBe('Couldn\'t read the Claude profiles: home is gone');
});

test('a list that fails shows its error in plain words', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ profiles: [], installed: true, conflicts: [], error: 'Couldn\'t read /Users/me/.agents/.mux-factory-install.json' });
  await open();
  expect(result().textContent).toBe('Couldn\'t read the Claude profiles: Couldn\'t read /Users/me/.agents/.mux-factory-install.json');
  expect(dialogText()).not.toContain('No Claude profiles found');
});

test('the dialog says Loading until the list arrives, also when opened again', async () => {
  const bridge = stubBridge();
  let finish!: (result: ProfilesResult) => void;
  bridge.listProfiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  expect(dialogText()).toContain('Loading…');
  expect(boxes()).toEqual([]);
  await settle(() => finish(listed));
  expect(dialogText()).not.toContain('Loading…');
  expect(boxes()).toHaveLength(2);

  await settle(() => closeButton().click());
  await settle(() => vi.advanceTimersByTime(50));
  bridge.listProfiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await settle(() => settingsButton()!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialogText()).toContain('Loading…');
  expect(boxes()).toEqual([]);
  await settle(() => finish(bothTicked));
  expect(boxes().map((box) => box.checked)).toEqual([true, true]);
});

test('a home without Claude profiles says so', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ profiles: [], installed: true, conflicts: [] });
  await open();
  expect(dialogText()).toContain('No Claude profiles found in ~.');
});

test('before the first install the boxes show disabled with the reason', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ ...listed, installed: false });
  await open();
  expect(dialogText()).toContain('Mux Factory hasn\'t installed its skills in ~/.agents yet');
  expect(boxes().map((box) => box.disabled)).toEqual([true, true]);
  await settle(() => boxes()[1]!.click());
  expect(bridge.setProfileTick).not.toHaveBeenCalled();
});

test('an open dialog turns the boxes on once the launch install finishes', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ ...listed, installed: false }).mockResolvedValueOnce({ ...listed, installed: false });
  await open();
  expect(dialogText()).toContain('ticks every profile it finds on that first install');
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS));
  expect(boxes().map((box) => box.disabled)).toEqual([true, true]);
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS));
  expect(bridge.listProfiles).toHaveBeenCalledTimes(3);
  expect(dialogText()).not.toContain('hasn\'t installed');
  expect(boxes().map((box) => box.disabled)).toEqual([false, false]);
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS * 2));
  expect(bridge.listProfiles).toHaveBeenCalledTimes(3);
});

test('a closed dialog stops reading the profiles', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValue({ ...listed, installed: false });
  await open();
  await settle(() => closeButton().click());
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS * 3));
  expect(bridge.listProfiles).toHaveBeenCalledOnce();
});

describe('update channel', () => {
  const nightly: UpdateState = {
    enabled: true, status: 'up-to-date', channel: 'nightly', currentVersion: '0.2.0-nightly.20261023.41',
    availableVersion: null, downloadedVersion: null, releaseNotes: [], omittedReleaseCount: 0, downloadPercent: null,
    checkedAt: '2026-10-23T09:00:00Z', message: null, errorContext: null, canRetry: false,
  };

  function stubChannel(start: UpdateState = nightly) {
    let push: (state: UpdateState) => void = () => {};
    const bridge = stubApp({
      listProfiles: vi.fn(async () => listed),
      getUpdateState: vi.fn(async () => start),
      onUpdateState: vi.fn((listener: (state: UpdateState) => void) => { push = listener; return () => {}; }),
      setUpdateChannel: vi.fn(async (channel: UpdateChannel) => ({ ...start, channel })),
    });
    return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
  }

  const radios = () => $$<HTMLInputElement>('#settings-dialog input[name="update-channel"]');
  const checked = () => radios().find((radio) => radio.checked)?.value;
  const radio = (channel: UpdateChannel) => radios().find((each) => each.value === channel)!;
  const status = () => $('#update-channel-status')!.textContent;

  test('shows the channel the app is on, nightly and latest to choose from', async () => {
    stubChannel();
    await open();
    expect($('.update-channel legend')!.textContent).toBe('Update channel');
    expect(radios().map((each) => [each.value, each.closest('label')!.textContent!.trim()])).toEqual([
      ['nightly', 'Nightly'], ['latest', 'Latest']]);
    expect(checked()).toBe('nightly');
    expect(status()).toBe('Up to date on 0.2.0-nightly.20261023.41.');
  });

  test('choosing a channel switches the app to it and shows what its check found', async () => {
    const { bridge, push } = stubChannel();
    await open();
    await settle(() => radio('latest').click());
    expect(bridge.setUpdateChannel).toHaveBeenCalledWith('latest');
    expect(checked()).toBe('latest');
    await push({ ...nightly, channel: 'latest', status: 'checking' });
    expect(status()).toBe('Checking for updates…');
    await push({ ...nightly, channel: 'latest', status: 'available', availableVersion: '0.1.9-nightly.20261020.12' });
    expect(status()).toBe('0.1.9-nightly.20261020.12 is available.');
  });

  test('a second choice waits until the first switch ends', async () => {
    const { bridge } = stubChannel();
    let finish!: (state: UpdateState) => void;
    bridge.setUpdateChannel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await open();
    await settle(() => radio('latest').click());
    expect(radio('nightly').getAttribute('aria-disabled')).toBe('true');
    await settle(() => radio('nightly').click());
    expect(bridge.setUpdateChannel).toHaveBeenCalledOnce();
    await settle(() => finish({ ...nightly, channel: 'latest' }));
    expect(checked()).toBe('latest');
    expect(radio('nightly').getAttribute('aria-disabled')).toBe('false');
  });

  test('the channels are busy while an update downloads or installs, when the app would refuse a switch', async () => {
    const downloaded: UpdateState = { ...nightly, status: 'downloaded', availableVersion: '0.2.0-nightly.20261024.42', downloadedVersion: '0.2.0-nightly.20261024.42', downloadPercent: 100, canRetry: true };
    const { bridge, push } = stubChannel({ ...downloaded, status: 'downloading', downloadedVersion: null, downloadPercent: 40 });
    bridge.installUpdate = vi.fn(() => new Promise<never>(() => {}));
    bridge.confirmRestart = answerRestart(true);
    await open();
    expect(radio('latest').getAttribute('aria-disabled')).toBe('true');
    await settle(() => radio('latest').click());
    expect(bridge.setUpdateChannel).not.toHaveBeenCalled();
    expect(checked()).toBe('nightly');

    await push(downloaded);
    expect(radio('latest').getAttribute('aria-disabled')).toBe('false');
    await settle(() => $<HTMLButtonElement>('.update-button')!.click());
    expect(radio('latest').getAttribute('aria-disabled')).toBe('true');
  });

  test('a refused switch keeps the old channel and says why', async () => {
    const { bridge } = stubChannel();
    bridge.setUpdateChannel.mockRejectedValueOnce(new Error('Cannot change the update channel to latest while an update download is in progress.'));
    await open();
    await settle(() => radio('latest').click());
    expect(checked()).toBe('nightly');
    expect(result().textContent).toBe('Couldn\'t switch to latest: Cannot change the update channel to latest while an update download is in progress.');
    expect(result().dataset.tone).toBe('error');
  });

  test('a failed download or install says why under the channel', async () => {
    // The states the app's reducers give them: the update stays available or downloaded.
    const available: UpdateState = { ...nightly, status: 'available', availableVersion: '0.2.0-nightly.20261024.42', canRetry: true };
    const { push } = stubChannel({ ...available, errorContext: 'download', message: 'net::ERR_TIMED_OUT' });
    await open();
    expect(status()).toBe('Couldn\'t download 0.2.0-nightly.20261024.42: net::ERR_TIMED_OUT');
    await push({ ...available, status: 'downloaded', downloadedVersion: available.availableVersion, errorContext: 'install', message: 'quit refused' });
    expect(status()).toBe('Couldn\'t install 0.2.0-nightly.20261024.42: quit refused');
  });

  test('an app whose updates are off says so under the channel', async () => {
    stubChannel({ ...nightly, enabled: false, status: 'disabled', message: 'Updates work only in the packaged app.' });
    await open();
    expect(status()).toBe('Updates work only in the packaged app.');
  });
});
