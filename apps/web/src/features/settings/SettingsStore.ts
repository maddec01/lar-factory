// The Settings page: whether it's open and on which section, the Skill folders the app's bridge lists, the tick
// being changed, the update channel being switched to, and what the last call did. Opening in the board app reads
// the install state and follows each change until Settings closes.

import { boardApp, type InstallSnapshot, type TargetSnapshot, type UpdateChannel } from '@lar-factory/shared';
import { create } from 'zustand';

import { targetFailure, targetResult, channelFailure } from './SettingsPresentation';
import { useUpdateStore } from '@/features/updates';
import { useInstallStore } from '@/services/install/install.hooks';

/** What the last call did, and the group it came from: the Skill folders or the updates. */
export interface SettingsResult {
    text: string;
    tone?: 'success' | 'warning' | 'danger';
    paths?: string[];
    from?: 'targets' | 'updates';
}

interface SettingsState {
    open: boolean;
    setOpen: (open: boolean) => void;
    /** The section shown. */
    section: string;
    setSection: (section: string) => void;
    /** Null while the install state loads. */
    project: string | null;
    openProject: (repo: string) => void;
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

/** The store's part of a snapshot. */
const fromSnapshot = ({ targets, installs, installed }: InstallSnapshot) => ({ targets, installs, installed });

/** Counts openings, so only the latest one's answer shows. */
let opening = 0;
/** Stops following the install state. */
let unfollow = () => {};

export const useSettingsStore = create<SettingsState>()((set, get) => ({
    open: false,
    section: 'general',
    project: null,
    openProject: (project) => set({ section: 'projects', project }),
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
        const unsubscribe = useInstallStore.subscribe(
            ({ snapshot }) => snapshot && latest() && set(fromSnapshot(snapshot)),
        );
        const stop = store.follow();

        unfollow = () => {
            unsubscribe();
            stop();
        };
        void store.read().then(
            (snapshot) => {
                if (!latest()) return;

                set(fromSnapshot(snapshot));
            },
            (error) =>
                latest() &&
                set({
                    targets: [],
                    result: targetFailure('read the Skill folders', error),
                }),
        );
    },
    setSection: (section) => set({ section: section === 'repos' ? 'projects' : section, project: null }),
    setTick: async (path, ticked) => {
        if (get().pending || !get().installed || !get().installs) return;

        set({ pending: path, result: { text: '' } });

        const target = get().targets?.find((candidate) => candidate.path === path);

        try {
            const { snapshot, conflicts = [], removed, error } = await boardApp()!.setTargetTick(path, ticked);

            useInstallStore.getState().accept(snapshot);

            set({ result: targetResult({ target, path, ticked, conflicts, removed, error }) });
        } catch (error) {
            set({ result: targetFailure(`change ${path}`, error) });
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
            set({
                result: channelFailure(channel, error),
            });
        } finally {
            set({ switchingTo: null });
        }
    },
}));
