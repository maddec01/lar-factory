// The update button's toasts, copied from T3 Code's apps/web/src/components/desktopUpdate.toast.tsx and the
// toast calls in apps/web/src/components/sidebar/SidebarUpdatePill.tsx at 9a391eb, shown through the board's
// toasts. Without the downloaded toast's link to the Release, as the board app's state has no release URLs.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see apps/desktop/LICENSE.

import { useToastStore } from '../notices/toast-store.ts';

/** The update toasts share one toast: a new one replaces the last. */
const SLOT = 'update';

function showUpdateToast(title: string, description: string, failed: boolean): void {
  useToastStore.getState().show({ slot: SLOT, failed, ...(failed && { tone: 'error' as const }), what: title, body: <><b>{title}</b> {description}</> });
}

/** A failed update action, as T3's error toast: it stays until it's closed, with a red dot. */
export function toastUpdateError(title: string, description: string): void {
  showUpdateToast(title, description, true);
}

/** The error's message, or `fallback` when it has none. */
export const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/** A download that finished, and T3's answer to an install the app refused. */
export function showUpdateDownloadedToast(): void {
  showUpdateToast('Update downloaded', 'Restart the app from the update button to install it.', false);
}

/** A download the app refused as another update action ran, worded as the refused install's toast. */
export function showUpdateNotDownloadedToast(): void {
  showUpdateToast('Update not downloaded', 'Download it from the update button once the updater is free.', false);
}
