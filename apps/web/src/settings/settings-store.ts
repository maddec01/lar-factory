// The Settings page: whether it's open and on which section, the Claude profiles the app's bridge lists, the tick
// being changed, the update channel being switched to, and what the last call did. Opening in the board app reads
// the profiles again, and keeps reading them until the app has installed its skills.

import { create } from 'zustand';
import type { ClaudeProfile } from '@lar-factory/shared/install-skills';
import { boardApp, type ProfilesResult, type UpdateChannel } from '@lar-factory/shared';
import { useUpdateStore } from '../updates/update-store.ts';

/** What the last call did, and the group it came from: the Claude profiles or the updates. */
export interface SettingsResult { text: string; tone?: 'success' | 'warning' | 'error'; paths?: string[]; from?: 'profiles' | 'updates' }

interface SettingsState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The section shown. */
  section: string;
  setSection: (section: string) => void;
  /** Null while the list loads. */
  profiles: ClaudeProfile[] | null;
  /** False until the app first installs its skills; until then no tick can change. */
  installed: boolean;
  /** The profile whose tick is being changed. */
  pending: string | null;
  result: SettingsResult;
  setTick: (name: string, ticked: boolean) => Promise<void>;
  /** The channel the app is switching to. */
  switchingTo: UpdateChannel | null;
  setChannel: (channel: UpdateChannel) => Promise<void>;
}

/** The profile as its path in the home. */
export const profilePath = (name: string) => `~/${name}`;

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What an untick removed, in words. */
function untickText(where: string, removed: ProfilesResult['removed']): string {
  const links = (removed?.links.length ?? 0) > 0;
  const checklists = removed?.checklists ?? false;
  if (links && checklists) return `Removed the skill links and checklists from ${where}.`;
  if (links) return `Removed the skill links from ${where}.`;
  if (checklists) return `Removed the checklists from ${where}.`;
  return `Lar Factory had no skill links or checklists in ${where} to remove.`;
}

/** Counts list calls, so only the latest one's answer shows. */
let listing = 0;

/** How often open Settings read the profiles again while the launch install hasn't finished. */
export const INSTALL_RECHECK_MS = 2000;

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  open: false,
  section: 'general',
  profiles: null,
  installed: true,
  pending: null,
  switchingTo: null,
  result: { text: '' },
  setOpen: (open) => {
    const call = ++listing;
    set({ open, profiles: null, result: { text: '' } });
    if (!open || !boardApp()) return;
    const latest = () => call === listing;
    const load = () => boardApp()!.listProfiles().then(
      ({ profiles, installed, error }) => {
        if (!latest()) return;
        set({ profiles, installed });
        if (error) set({ result: { text: `Couldn't read the Claude profiles: ${error}`, tone: 'error', from: 'profiles' } });
        // Until the launch install finishes, so the switches turn on without reopening Settings.
        else if (!installed) setTimeout(() => latest() && void load(), INSTALL_RECHECK_MS);
      },
      (error) => latest() && set({ profiles: [], result: { text: `Couldn't read the Claude profiles: ${failure(error)}`, tone: 'error', from: 'profiles' } }),
    );
    void load();
  },
  setSection: (section) => set({ section }),
  setTick: async (name, ticked) => {
    if (get().pending || !get().installed) return;
    set({ pending: name, result: { text: '' } });
    const where = profilePath(name);
    try {
      const { profiles, installed, conflicts, removed, error } = await boardApp()!.setProfileTick(name, ticked);
      set({ profiles, installed });
      if (error) set({ result: { text: `Couldn't change ${where}: ${error}`, tone: 'error', from: 'profiles' } });
      else if (conflicts.length) set({ result: { text: `Linked ${where}, but left these alone because Lar Factory didn't make them:`, tone: 'warning', paths: conflicts, from: 'profiles' } });
      else set({ result: { text: ticked ? `Linked the skills and checklists into ${where}.` : untickText(where, removed), tone: 'success', from: 'profiles' } });
    } catch (error) {
      set({ result: { text: `Couldn't change ${where}: ${failure(error)}`, tone: 'error', from: 'profiles' } });
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
