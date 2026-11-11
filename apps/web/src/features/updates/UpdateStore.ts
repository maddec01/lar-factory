import { boardApp, type UpdateState } from '@lar-factory/shared';
import { create } from 'zustand';

import { canCheckForUpdate, getUpdateActionError, resolveUpdateButtonAction } from './UpdateButtonLogic';
import {
    errorMessage,
    showUpdateDownloadedToast,
    showUpdateNotDownloadedToast,
    toastUpdateError,
} from './UpdateToasts';

export interface UpdateStore {
    state: UpdateState | null;
    /** The shared restart confirmation is open. */
    confirming: boolean;
    cancelInstall: () => void;
    confirmInstall: () => Promise<void>;
    /** From the install click until the app quits, or until the install fails. */
    installing: boolean;
    /** From a `run` until the app answers it; another `run` meanwhile does nothing. */
    pending: boolean;
    /** Reads the state and follows the app's pushes; returns the function that stops following. */
    follow: () => () => void;
    /** Asks the app to check for an update now. */
    check: () => Promise<void>;
    /** Asks the app to download the available update. */
    download: () => Promise<void>;
    /** Opens the shared restart confirmation. */
    install: () => Promise<void>;
    /** The update's next step: downloads an available update, or installs a downloaded one. */
    run: () => Promise<void>;
}

/** Whether `state` ends an install: it failed, or there is no downloaded update to install. */
const endsInstall = (state: UpdateState) => state.errorContext === 'install' || state.status !== 'downloaded';

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
    state: null,
    installing: false,
    confirming: false,
    pending: false,
    follow: () => {
        const bridge = boardApp();

        if (!bridge) return () => {};

        let pushed = false;
        const stop = bridge.onUpdateState((state) => {
            pushed = true;
            set({ state, ...(endsInstall(state) && get().installing && { installing: false, confirming: false }) });
        });

        // A push that lands before the read answers is newer, so the read doesn't overwrite it.
        void bridge.getUpdateState().then(
            (state) => pushed || set({ state }),
            () => {},
        );

        return stop;
    },
    check: async () => {
        const { state, pending, installing, confirming } = get();

        if (!boardApp() || pending || installing || confirming || !canCheckForUpdate(state)) return;

        set({ pending: true });

        try {
            const result = await boardApp()!.checkForUpdate();

            if (!result.checked) {
                toastUpdateError(
                    'Couldn’t check for updates',
                    result.state.message ?? 'Automatic updates aren’t available in this build.',
                );
            }
        } catch (error) {
            toastUpdateError('Couldn’t check for updates', errorMessage(error, 'Update check failed.'));
        } finally {
            set({ pending: false });
        }
    },
    download: async () => {
        const { state, pending, installing, confirming } = get();

        if (
            !boardApp() ||
            !state ||
            pending ||
            installing ||
            confirming ||
            resolveUpdateButtonAction(state) !== 'download'
        )
            return;

        set({ pending: true });

        try {
            const result = await boardApp()!.downloadUpdate();

            if (!result.accepted) showUpdateNotDownloadedToast();

            if (result.completed) showUpdateDownloadedToast();

            const actionError = getUpdateActionError(result);

            if (actionError) toastUpdateError('Couldn’t download update', actionError);
        } catch (error) {
            toastUpdateError('Couldn’t start update download', errorMessage(error, 'An unexpected error occurred.'));
        } finally {
            set({ pending: false });
        }
    },
    install: async () => {
        const { state, pending, installing, confirming } = get();

        if (
            !boardApp() ||
            !state ||
            pending ||
            installing ||
            confirming ||
            resolveUpdateButtonAction(state) !== 'install'
        )
            return;

        set({ confirming: true });
    },
    cancelInstall: () => {
        if (!get().installing) set({ confirming: false });
    },
    confirmInstall: async () => {
        const { state, pending, installing, confirming } = get();

        if (!state || pending || installing || !confirming || resolveUpdateButtonAction(state) !== 'install') return;

        set({ installing: true });

        try {
            // A successful install quits the app, so the answer only comes when it didn't take or failed.
            const result = await boardApp()!.installUpdate();

            if (!result.accepted) {
                set({ installing: false, confirming: false });
                // Deliberately the downloaded toast, as T3's installLocalUpdate shows showDesktopUpdateDownloadedToast for a
                // refused install (SidebarUpdatePill.tsx at 9a391eb): the update is still there to install.
                showUpdateDownloadedToast();

                return;
            }

            if (endsInstall(result.state)) set({ installing: false, confirming: false });

            const actionError = getUpdateActionError(result);

            if (actionError) toastUpdateError('Couldn’t install update', actionError);
        } catch (error) {
            set({ installing: false, confirming: false });
            toastUpdateError('Couldn’t install update', errorMessage(error, 'An unexpected error occurred.'));
        }
    },
    run: async () => {
        const state = get().state;
        const action = state ? resolveUpdateButtonAction(state) : 'none';

        if (action === 'download') await get().download();

        if (action === 'install') await get().install();
    },
}));
