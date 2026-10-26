// The Settings page: the sidebar's section list with search and Back, the breadcrumb over each section's rows, the
// Claude profiles with their switches and what a change did, the update channel, version and Check now, the tool
// and repository rows, and the rows that aren't built yet. The bridge stands in for the app's preload; without it
// the profiles and updates show disabled.

import { describe, expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, answerRestart, mountPage, sample, settle, stubApp, text } from '../../test/support.ts';
import type { BoardData, ProfilesResult, UpdateChannel, UpdateState } from '@lar-factory/shared';
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
const sections = () => $$<HTMLButtonElement>('.settings-nav button');
const section = (label: string) => sections().find((b) => text(b) === label)!;
const back = () => [...$$<HTMLButtonElement>('.settings-foot button')].find((b) => text(b) === 'Back')!;
const body = () => $('.settings-body')!;
const row = (id: string) => $(`.settings-row[data-row="${id}"]`)!;
const switches = () => $$<HTMLButtonElement>('.settings-body [role="switch"]');
const ticked = (box: Element) => box.getAttribute('aria-checked') === 'true';
const result = () => $('#settings-result')!;
const search = () => $<HTMLInputElement>('.sidebar input[aria-label="Search settings"]')!;

async function type(input: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Mounts the page with `data`, opens Settings and shows `label`'s section. */
async function open(label = 'Skills', data: BoardData = sample): Promise<void> {
  await mountPage(data);
  await settle(() => settingsButton()!.click());
  await settle(() => section(label).click());
  await settle(() => vi.advanceTimersByTime(50));
}

test('Settings opens from the sidebar\'s foot, in a browser too, and replaces the List and the title bar', async () => {
  await mountPage();
  expect(settingsButton()!.getAttribute('aria-label')).toBe('Settings');
  await settle(() => settingsButton()!.click());
  expect(sections().map(text)).toEqual(['General', 'Appearance', 'Repositories', 'T3 Code', 'Skills', 'Notifications', 'Keybindings', 'Updates', 'Archive', 'Diagnostics']);
  expect(section('General').getAttribute('aria-current')).toBe('page');
  expect($('.list-group')!.closest('[hidden]'), 'the List hides').not.toBeNull();
  expect($('.title-bar')!.closest('[hidden]'), 'the title bar hides').not.toBeNull();
  expect(text($('.settings-header'))).toBe('Settings›General Restore defaults');
  expect($$('.settings-group h3').map(text)).toEqual(['Board', 'Flow limits', 'App']);
});

test('a section shows in the breadcrumb and the main area', async () => {
  await open('Notifications');
  expect(text($('.settings-header h1'))).toBe('Notifications');
  expect(section('Notifications').getAttribute('aria-current')).toBe('page');
  expect($$('.settings-group h3').map(text)).toEqual(['Tell me when', 'Delivery']);
});

test('search keeps the sections whose name or a row matches, and / focuses it', async () => {
  await open('General');
  await type(search(), 'dock');
  expect(sections().map(text)).toEqual(['General']);
  await type(search(), 'up');
  expect(sections().map(text)).toEqual(['Skills', 'Updates']);
  search().blur();
  await settle(() => dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(search());
});

test('Back returns to the board with the sidebar as it was', async () => {
  await mountPage();
  const collapse = $<HTMLButtonElement>('.list-group[data-platform="Server"] button[aria-expanded]')!;
  await settle(() => collapse.click());
  await settle(() => $<HTMLButtonElement>('.list-group[data-platform="Apple"] .scope')!.click());
  await settle(() => settingsButton()!.click());
  await settle(() => back().click());
  expect($('.settings-nav')).toBeNull();
  expect($('.settings-body')).toBeNull();
  expect($('.list-group')!.closest('[hidden]')).toBeNull();
  expect($('.list-group[data-platform="Server"] button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false');
  expect(text($('.title-bar .scope'))).toBe('Apple');
});

test.each([[15, '15 seconds'], [60, '1 minute'], [300, '5 minutes'], [120, '2 minutes']])('Refresh every shows the board\'s %i s as %s', async (seconds, label) => {
  await open('General', { ...sample, refreshSeconds: seconds });
  const refresh = row('refresh').querySelector('select')!;
  expect(refresh.value).toBe(label);
  expect(refresh.selectedOptions[0]!.textContent).toBe(label);
});

test('a row that isn\'t built yet shows the prototype\'s value, disabled, and says so', async () => {
  await open('General');
  const refresh = row('refresh').querySelector('select')!;
  expect([refresh.value, refresh.disabled]).toEqual(['45 seconds', true]);
  expect(row('refresh').querySelector('.shown-control')!.getAttribute('title')).toBe('Refresh every isn\'t built yet');
  expect(row('login').querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
  expect($$<HTMLButtonElement>('.settings-body button').every((b) => b.disabled)).toBe(true);
  const restore = [...$$<HTMLButtonElement>('.settings-header button')].find((b) => text(b).trim() === 'Restore defaults')!;
  expect([restore.disabled, restore.title]).toEqual([true, 'Restore defaults isn\'t built yet']);
});

test('with the sidebar hidden, the header starts T3\'s gap past the toggle', async () => {
  await open('General');
  expect($('.settings-header')!.className.split(' ')).toContain('pl-4');
  await settle(() => $<HTMLButtonElement>('.sidebar-toggle')!.click());
  expect($('.settings-header')!.className.split(' ')).toContain('pl-[var(--workspace-titlebar-content-left)]');
});

test('the header drags the window, but not Restore defaults', async () => {
  await open('General');
  const { noDrag } = addStylesheet();
  expect($('.settings-header')!.className).toContain('[-webkit-app-region:drag]');
  expect(noDrag($('.settings-header button')!.parentElement!)).toBe(true);
});

test('Repositories shows the GitHub Project, gh\'s login and each repository with its role, read-only', async () => {
  await open('Repositories', { ...sample, project: { owner: 'maddec01', title: 'lar' } });
  expect(row('project').querySelector('input')!.value).toBe('maddec01 / lar');
  expect(text(row('gh').querySelector('.tool-state'))).toBe('● Signed in');
  expect(sample.repos.map((r) => text(row(`repo-${r.repo}`)))).toEqual(sample.repos.map((r) => `${r.repo}${r.role}${r.platform}Edit`));
  expect(row('project').querySelector('input')!.readOnly).toBe(true);
  expect($$<HTMLButtonElement>('.settings-body button').map((b) => [text(b), b.disabled])).toEqual([
    ...sample.repos.map(() => ['Edit', true]), ['Add repository', true]]);
});

test('Diagnostics shows gh and t3 OK while the lookup finds them', async () => {
  await open('Diagnostics');
  expect(['d-gh', 'd-t3'].map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● OK', '● OK']);
});

test('Diagnostics shows what the lookup found wrong with gh and t3', async () => {
  await open('Diagnostics', { ...sample, tools: { gh: { problem: 'logged-out' }, t3: { problem: 'missing', override: 'T3_BIN=/nowhere/t3' } } });
  expect(['d-gh', 'd-t3'].map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● Logged out', '● Not found']);
  expect(text(row('d-t3'))).toContain('Nothing runnable at T3_BIN=/nowhere/t3');
});

test('in a browser the profiles and updates show disabled, since only the board app has them', async () => {
  await open('Skills');
  expect(switches().slice(0, 3).map((s) => [s.getAttribute('aria-label'), ticked(s), s.disabled])).toEqual([
    ['~/.claude', true, true], ['~/.claude-personal', true, true], ['~/.claude-work', false, true]]);
  expect(row('profile-~/.claude').querySelector('.shown-control')!.getAttribute('title')).toBe('Only the board app links skills into Claude profiles');
  await settle(() => section('Updates').click());
  expect($$<HTMLButtonElement>('.settings-body [role="radio"]').map((r) => r.disabled)).toEqual([true, true]);
  expect(row('version').querySelector('.shown-control')!.getAttribute('title')).toBe('Only the board app updates itself');
});

test('Skills lists every Claude profile with its tick', async () => {
  const bridge = stubBridge();
  await open();
  expect(bridge.listProfiles).toHaveBeenCalledOnce();
  expect(switches().slice(0, 2).map((s) => [s.getAttribute('aria-label'), ticked(s)])).toEqual([['~/.claude', true], ['~/.claude-work', false]]);
  expect([result().getAttribute('role'), result().dataset.slot]).toEqual(['status', 'alert']);
});

test('ticking a profile installs it and shows the new ticks', async () => {
  const bridge = stubBridge(bothTicked);
  await open();
  await settle(() => switches()[1]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledWith('.claude-work', true);
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, true]);
  expect(result().textContent).toBe('Linked the skills and checklists into ~/.claude-work.');
  expect(result().dataset.variant).toBe('success');
});

test('focus stays on a switch while its change runs and after', async () => {
  const bridge = stubBridge();
  let finish!: (result: ProfilesResult) => void;
  bridge.setProfileTick.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  const box = switches()[1]!;
  box.focus();
  await settle(() => box.click());
  // A browser blurs a control that turns disabled; jsdom doesn't, so check it stays enabled too.
  expect(box.disabled).toBe(false);
  expect(document.activeElement).toBe(box);
  expect(box.getAttribute('aria-disabled')).toBe('true');
  await settle(() => switches()[0]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledOnce();
  await settle(() => finish(bothTicked));
  expect(document.activeElement).toBe(switches()[1]);
  expect(switches()[1]!.getAttribute('aria-disabled')).toBe('false');
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, true]);
});

test('unticking a profile removes its links', async () => {
  const bridge = stubBridge({ ...listed, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }],
    removed: { links: ['tdd'], checklists: true } });
  await open();
  await settle(() => switches()[0]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledWith('.claude', false);
  expect(ticked(switches()[0]!)).toBe(false);
  expect(result().textContent).toBe('Removed the skill links and checklists from ~/.claude.');
});

test('unticking says only what it removed', async () => {
  const bridge = stubBridge({ ...bothTicked, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: true }],
    removed: { links: ['tdd'], checklists: false } });
  bridge.listProfiles.mockResolvedValueOnce(bothTicked);
  await open();
  await settle(() => switches()[0]!.click());
  expect(result().textContent).toBe('Removed the skill links from ~/.claude.');

  bridge.setProfileTick.mockResolvedValueOnce({ ...listed, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }],
    removed: { links: [], checklists: false } });
  await settle(() => switches()[1]!.click());
  expect(bridge.setProfileTick).toHaveBeenLastCalledWith('.claude-work', false);
  expect(result().textContent).toBe('Lar Factory had no skill links or checklists in ~/.claude-work to remove.');
});

test('a tick that left paths alone names each one', async () => {
  stubBridge({ ...bothTicked, conflicts: ['~/.claude-work/skills/lar-work'] });
  await open();
  await settle(() => switches()[1]!.click());
  expect(result().textContent).toContain('left these alone because Lar Factory didn\'t make them');
  expect($$('#settings-result li').map((li) => li.textContent)).toEqual(['~/.claude-work/skills/lar-work']);
  expect(result().dataset.variant).toBe('warning');
});

test('a failed tick shows its error and keeps the old ticks', async () => {
  stubBridge({ ...listed, error: 'No skills are installed in /Users/me/.agents yet' });
  await open();
  await settle(() => switches()[1]!.click());
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, false]);
  expect(result().textContent).toBe('Couldn\'t change ~/.claude-work: No skills are installed in /Users/me/.agents yet');
  expect(result().dataset.variant).toBe('error');
});

test('a profile\'s result shows under the profiles only', async () => {
  stubBridge(bothTicked);
  await open();
  await settle(() => switches()[1]!.click());
  await settle(() => section('Updates').click());
  expect(result().textContent).toBe('');
  await settle(() => section('Skills').click());
  expect(result().textContent).toBe('Linked the skills and checklists into ~/.claude-work.');
});

test('a bridge that throws shows the error', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockRejectedValueOnce(new Error('home is gone'));
  await open();
  expect($('.settings-row[data-row="profile-.claude"]')).toBeNull();
  expect(result().textContent).toBe('Couldn\'t read the Claude profiles: home is gone');
});

test('a list that fails shows its error in plain words', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ profiles: [], installed: true, conflicts: [], error: 'Couldn\'t read /Users/me/.agents/.lar-factory-install.json' });
  await open();
  expect(result().textContent).toBe('Couldn\'t read the Claude profiles: Couldn\'t read /Users/me/.agents/.lar-factory-install.json');
  expect(text(body())).not.toContain('No Claude profiles found');
});

test('Skills says Loading until the list arrives, also when opened again', async () => {
  const bridge = stubBridge();
  let finish!: (result: ProfilesResult) => void;
  bridge.listProfiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  expect(text(body())).toContain('Loading…');
  expect($('.settings-row[data-row="profile-.claude"]')).toBeNull();
  await settle(() => finish(listed));
  expect(text(body())).not.toContain('Loading…');
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, false]);

  await settle(() => back().click());
  bridge.listProfiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await settle(() => settingsButton()!.click());
  expect(section('Skills').getAttribute('aria-current'), 'Settings opens on the section it showed').toBe('page');
  expect(text(body())).toContain('Loading…');
  await settle(() => finish(bothTicked));
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, true]);
});

test('a home without Claude profiles says so', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ profiles: [], installed: true, conflicts: [] });
  await open();
  expect(text(body())).toContain('No Claude profiles found in ~.');
});

test('before the first install the switches show disabled with the reason', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ ...listed, installed: false });
  await open();
  expect(text(body())).toContain('Lar Factory hasn\'t installed its skills in ~/.agents yet');
  expect(switches().slice(0, 2).map((s) => s.disabled)).toEqual([true, true]);
  await settle(() => switches()[1]!.click());
  expect(bridge.setProfileTick).not.toHaveBeenCalled();
});

test('open Settings turn the switches on once the launch install finishes', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ ...listed, installed: false }).mockResolvedValueOnce({ ...listed, installed: false });
  await open();
  expect(text(body())).toContain('ticks every profile it finds on that first install');
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS));
  expect(switches().slice(0, 2).map((s) => s.disabled)).toEqual([true, true]);
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS));
  expect(bridge.listProfiles).toHaveBeenCalledTimes(3);
  expect(text(body())).not.toContain('hasn\'t installed');
  expect(switches().slice(0, 2).map((s) => s.disabled)).toEqual([false, false]);
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS * 2));
  expect(bridge.listProfiles).toHaveBeenCalledTimes(3);
});

test('Back stops reading the profiles', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValue({ ...listed, installed: false });
  await open();
  await settle(() => back().click());
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS * 3));
  expect(bridge.listProfiles).toHaveBeenCalledOnce();
});

describe('updates', () => {
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
      checkForUpdate: vi.fn(async () => ({ checked: true, state: start })),
    });
    return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
  }

  const radios = () => $$<HTMLButtonElement>('.settings-body [role="radio"]');
  const checked = () => radios().find((each) => each.getAttribute('aria-checked') === 'true')?.value;
  const radio = (channel: UpdateChannel) => radios().find((each) => each.value === channel)!;
  const status = () => $('#update-status')!.textContent;
  const checkNow = () => $<HTMLButtonElement>('.settings-body .check-now')!;

  test('shows the channel the app is on, nightly and latest to choose from, and the version', async () => {
    stubChannel();
    await open('Updates');
    expect($('.settings-body [role="radiogroup"]')!.getAttribute('aria-label')).toBe('Update channel');
    expect(radios().map((each) => [each.value, text(each)])).toEqual([['nightly', 'Nightly'], ['latest', 'Latest']]);
    expect(checked()).toBe('nightly');
    expect(text(row('version'))).toContain('Lar Factory 0.2.0-nightly.20261023.41');
    expect(status()).toBe('Up to date on 0.2.0-nightly.20261023.41.');
  });

  test('choosing a channel switches the app to it and shows what its check found', async () => {
    const { bridge, push } = stubChannel();
    await open('Updates');
    await settle(() => radio('latest').click());
    expect(bridge.setUpdateChannel).toHaveBeenCalledWith('latest');
    expect(checked()).toBe('latest');
    await push({ ...nightly, channel: 'latest', status: 'checking' });
    expect(status()).toBe('Checking for updates…');
    expect(checkNow().disabled).toBe(true);
    await push({ ...nightly, channel: 'latest', status: 'available', availableVersion: '0.1.9-nightly.20261020.12' });
    expect(status()).toBe('0.1.9-nightly.20261020.12 is available.');
  });

  test('Check now asks the app to check', async () => {
    const { bridge } = stubChannel();
    await open('Updates');
    expect(checkNow().disabled).toBe(false);
    await settle(() => checkNow().click());
    expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
  });

  test('a second choice waits until the first switch ends', async () => {
    const { bridge } = stubChannel();
    let finish!: (state: UpdateState) => void;
    bridge.setUpdateChannel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await open('Updates');
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
    await open('Updates');
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
    await open('Updates');
    await settle(() => radio('latest').click());
    expect(checked()).toBe('nightly');
    expect(result().textContent).toBe('Couldn\'t switch to latest: Cannot change the update channel to latest while an update download is in progress.');
    expect(result().dataset.variant).toBe('error');
  });

  test('a failed download or install says why under the version', async () => {
    // The states the app's reducers give them: the update stays available or downloaded.
    const available: UpdateState = { ...nightly, status: 'available', availableVersion: '0.2.0-nightly.20261024.42', canRetry: true };
    const { push } = stubChannel({ ...available, errorContext: 'download', message: 'net::ERR_TIMED_OUT' });
    await open('Updates');
    expect(status()).toBe('Couldn\'t download 0.2.0-nightly.20261024.42: net::ERR_TIMED_OUT');
    await push({ ...available, status: 'downloaded', downloadedVersion: available.availableVersion, errorContext: 'install', message: 'quit refused' });
    expect(status()).toBe('Couldn\'t install 0.2.0-nightly.20261024.42: quit refused');
  });

  test('an app whose updates are off says so, and Check now gives the reason', async () => {
    stubChannel({ ...nightly, enabled: false, status: 'disabled', message: 'Updates work only in the packaged app.' });
    await open('Updates');
    expect(status()).toBe('Updates work only in the packaged app.');
    expect([checkNow().disabled, checkNow().title]).toEqual([true, 'Updates work only in the packaged app.']);
  });

  test('above the missing-t3 notice, where the sidebar has no update button, the page still reads the updater', async () => {
    stubChannel();
    await open('Updates', { ...sample, tools: { t3: { problem: 'missing' } } });
    expect($('.update-button')).toBeNull();
    expect(checked()).toBe('nightly');
  });
});
