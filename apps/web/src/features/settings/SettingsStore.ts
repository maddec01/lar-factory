// The Settings page: whether it's open and on which section, the update channel being switched to, and what the last
// switch did.

import { boardApp, type UpdateChannel } from '@lar-factory/shared';
import { create } from 'zustand';

import { channelFailure } from './SettingsPresentation';
import { useUpdateStore } from '@/features/updates';

/** What the last channel switch did. */
export interface SettingsResult {
    text: string;
    tone?: 'success' | 'warning' | 'danger';
}

interface SettingsState {
    open: boolean;
    setOpen: (open: boolean) => void;
    /** The section shown. */
    section: string;
    setSection: (section: string) => void;
    project: string | null;
    openProject: (repo: string) => void;
    result: SettingsResult;
    /** The channel the app is switching to. */
    switchingTo: UpdateChannel | null;
    setChannel: (channel: UpdateChannel) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
    open: false,
    section: 'general',
    project: null,
    openProject: (project) => set({ section: 'projects', project }),
    switchingTo: null,
    result: { text: '' },
    setOpen: (open) => set({ open, result: { text: '' } }),
    setSection: (section) => set({ section: section === 'repos' ? 'projects' : section, project: null }),
    setChannel: async (channel) => {
        if (get().switchingTo) return;

        set({ switchingTo: channel, result: { text: '' } });

        try {
            useUpdateStore.setState({ state: await boardApp()!.setUpdateChannel(channel) });
        } catch (error) {
            set({
                result: channelFailure(channel, error),
            });
        } finally {
            set({ switchingTo: null });
        }
    },
}));
