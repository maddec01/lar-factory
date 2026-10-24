// The app's Settings dialog: whether it's open, the Claude profiles the app's bridge lists, the tick
// being changed, the update channel being switched to, and what the last call did. Opening reads the
// profiles again, and keeps reading them until the app has installed its skills.

import { create } from 'zustand';
import type { ClaudeProfile } from '@mux-factory/shared/install-skills';
import { boardApp, type ProfilesResult, type UpdateChannel } from '@mux-factory/shared';
import { useUpdateStore } from '../updates/update-store.ts';

export interface SettingsResult { text: string; tone?: 'success' | 'warning' | 'error'; paths?: string[] }

interface SettingsState {
  open: boolean;
  setOpen: (open: boolean) => void;
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
  return `Mux Factory had no skill links or checklists in ${where} to remove.`;
}

/** Counts list calls, so only the latest one's answer shows. */
let listing = 0;

/** How often an open dialog reads the profiles again while the launch install hasn't finished. */
export const INSTALL_RECHECK_MS = 2000;

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  open: false,
  profiles: null,
  installed: true,
  pending: null,
  switchingTo: null,
  result: { text: '' },
  setOpen: (open) => {
    const call = ++listing;
    set({ open, profiles: null, result: { text: '' } });
    if (!open) return;
    const latest = () => call === listing;
    const load = () => boardApp()!.listProfiles().then(
      ({ profiles, installed, error }) => {
        if (!latest()) return;
        set({ profiles, installed });
        if (error) set({ result: { text: `Couldn't read the Claude profiles: ${error}`, tone: 'error' } });
        // Until the launch install finishes, so the boxes turn on without reopening the dialog.
        else if (!installed) setTimeout(() => latest() && void load(), INSTALL_RECHECK_MS);
      },
      (error) => latest() && set({ profiles: [], result: { text: `Couldn't read the Claude profiles: ${failure(error)}`, tone: 'error' } }),
    );
    void load();
  },
  setTick: async (name, ticked) => {
    if (get().pending || !get().installed) return;
    set({ pending: name, result: { text: '' } });
    const where = profilePath(name);
    try {
      const { profiles, installed, conflicts, removed, error } = await boardApp()!.setProfileTick(name, ticked);
      set({ profiles, installed });
      if (error) set({ result: { text: `Couldn't change ${where}: ${error}`, tone: 'error' } });
      else if (conflicts.length) set({ result: { text: `Linked ${where}, but left these alone because Mux Factory didn't make them:`, tone: 'warning', paths: conflicts } });
      else set({ result: { text: ticked ? `Linked the skills and checklists into ${where}.` : untickText(where, removed), tone: 'success' } });
    } catch (error) {
      set({ result: { text: `Couldn't change ${where}: ${failure(error)}`, tone: 'error' } });
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
      set({ result: { text: `Couldn't switch to ${channel}: ${failure(error)}`, tone: 'error' } });
    } finally {
      set({ switchingTo: null });
    }
  },
}));
