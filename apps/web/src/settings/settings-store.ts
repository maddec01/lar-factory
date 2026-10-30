// The Settings page: whether it's open and on which section, the Install targets the app's bridge lists, the tick
// being changed, the update channel being switched to, and what the last call did. Opening in the board app reads
// the install state and follows each change until Settings closes.

import { create } from 'zustand';
import { boardApp, type InstallOperationResult, type InstallSnapshot, type TargetSnapshot, type UpdateChannel } from '@lar-factory/shared';
import { useInstallStore } from './install-store.ts';
import { useUpdateStore } from '../updates/update-store.ts';

/** What the last call did, and the group it came from: the Install targets or the updates. */
export interface SettingsResult { text: string; tone?: 'success' | 'warning' | 'error'; paths?: string[]; from?: 'targets' | 'updates' }

interface SettingsState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The section shown. */
  section: string;
  setSection: (section: string) => void;
  /** Null while the install state loads. */
  targets: TargetSnapshot[] | null;
  /** False when this run of the app installs nothing; then no tick can change. */
  installs: boolean;
  /** False until the app first installs its skills; until then no tick can change. */
  installed: boolean;
  /** The path of the target whose tick is being changed. */
  pending: string | null;
  result: SettingsResult;
  setTick: (path: string, ticked: boolean) => Promise<void>;
  /** The channel the app is switching to. */
  switchingTo: UpdateChannel | null;
  setChannel: (channel: UpdateChannel) => Promise<void>;
}

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What an untick removed, in words. */
function untickText(target: TargetSnapshot | undefined, where: string, removed: InstallOperationResult['removed']): string {
  if (target?.kind !== 'claude') return `Lar Factory no longer installs into ${where}, and left its copies there.`;
  const links = (removed?.links.length ?? 0) > 0;
  const checklists = removed?.checklists ?? false;
  if (links && checklists) return `Removed the skill links and checklists from ${where}.`;
  if (links) return `Removed the skill links from ${where}.`;
  if (checklists) return `Removed the checklists from ${where}.`;
  return `Lar Factory had no skill links or checklists in ${where} to remove.`;
}

/** The store's part of a snapshot. */
const fromSnapshot = ({ targets, installs, installed }: InstallSnapshot) => ({ targets, installs, installed });

/** Counts openings, so only the latest one's answer shows. */
let opening = 0;
/** Stops following the install state. */
let unfollow = () => {};

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  open: false,
  section: 'general',
  targets: null,
  installs: true,
  installed: true,
  pending: null,
  switchingTo: null,
  result: { text: '' },
  setOpen: (open) => {
    const call = ++opening;
    unfollow();
    unfollow = () => {};
    set({ open, targets: null, result: { text: '' } });
    const app = boardApp();
    if (!open || !app) return;
    const latest = () => call === opening;
    const store = useInstallStore.getState();
    const unsubscribe = useInstallStore.subscribe(({ snapshot }) => snapshot && latest() && set(fromSnapshot(snapshot)));
    const stop = store.follow();
    unfollow = () => { unsubscribe(); stop(); };
    void store.read().then(
      (snapshot) => {
        if (!latest()) return;
        set(fromSnapshot(snapshot));
        if (snapshot.error) set({ result: { text: snapshot.error, tone: 'error', from: 'targets' } });
      },
      (error) => latest() && set({ targets: [], result: { text: `Couldn't read the Install targets: ${failure(error)}`, tone: 'error', from: 'targets' } }),
    );
  },
  setSection: (section) => set({ section }),
  setTick: async (path, ticked) => {
    if (get().pending || !get().installed || !get().installs) return;
    set({ pending: path, result: { text: '' } });
    const target = get().targets?.find((candidate) => candidate.path === path);
    try {
      const { snapshot, conflicts = [], removed, error } = await boardApp()!.setTargetTick(path, ticked);
      useInstallStore.getState().accept(snapshot);
      if (error) set({ result: { text: `Couldn't change ${path}: ${error}`, tone: 'error', from: 'targets' } });
      else if (conflicts.length) set({ result: { text: `Installed into ${path}, but left these alone because Lar Factory didn't make them:`, tone: 'warning', paths: conflicts, from: 'targets' } });
      else set({ result: { text: ticked ? `Installed the skills into ${path}.` : untickText(target, path, removed), tone: 'success', from: 'targets' } });
    } catch (error) {
      set({ result: { text: `Couldn't change ${path}: ${failure(error)}`, tone: 'error', from: 'targets' } });
    } finally {
      set({ pending: null });
    }
  },
  setChannel: async (channel) => {
    if (get().switchingTo) return;
    set({ switchingTo: channel, result: { text: '' } });
    try {
      useUpdateStore.setState({ state: await boardApp()!.setUpdateChannel(channel) });
    } catch (error) {
      set({ result: { text: `Couldn't switch to ${channel}: ${failure(error)}`, tone: 'error', from: 'updates' } });
    } finally {
      set({ switchingTo: null });
    }
  },
}));
