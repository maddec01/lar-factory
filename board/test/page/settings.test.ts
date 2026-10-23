// The app's Settings dialog: the Claude profiles with their ticks, and what a tick change did.
// The bridge stands in for the app's preload; without it the page has no Settings.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, mountPage, settle } from './support.ts';
import type { BoardAppBridge, ProfilesResult } from '../../src/app/board-app.ts';
import { INSTALL_RECHECK_MS } from '../../src/app/settings-store.ts';

const listed: ProfilesResult = {
  profiles: [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: false }],
  installed: true,
  conflicts: [],
};

const bothTicked: ProfilesResult = { ...listed, profiles: [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: true }] };

function stubBridge(setResult: ProfilesResult = listed) {
  const bridge = {
    platform: 'darwin',
    listProfiles: vi.fn(async () => listed),
    setProfileTick: vi.fn(async (_name: string, _ticked: boolean) => setResult),
  } satisfies Pick<BoardAppBridge, 'platform' | 'listProfiles' | 'setProfileTick'>;
  vi.stubGlobal('boardApp', bridge);
  return bridge;
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
