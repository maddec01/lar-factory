// Which action the update button runs and the tooltip it shows, copied from T3 Code's
// apps/web/src/components/desktopUpdate.logic.ts at 9a391eb, without the release URLs, the Intel build
// warning and the not-applied update, which the board app's state doesn't have.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see app/LICENSE.

import type { UpdateState } from './board-app.ts';

export type UpdateButtonAction = 'download' | 'install' | 'none';

export function resolveUpdateButtonAction(state: UpdateState): UpdateButtonAction {
  if (
    state.downloadedVersion &&
    (state.status === 'downloaded' ||
      (state.status === 'error' && (state.errorContext === null || state.errorContext === 'install')))
  ) {
    return 'install';
  }
  if (state.status === 'available') {
    return 'download';
  }
  if (state.status === 'error') {
    if (state.errorContext === 'download' && state.availableVersion) {
      return 'download';
    }
  }
  return 'none';
}

export function isUpdateButtonDisabled(state: UpdateState | null): boolean {
  return state?.status === 'downloading';
}

export function getUpdateButtonTooltip(state: UpdateState): string {
  if (state.status === 'available') {
    return `Update ${state.availableVersion ?? 'available'} ready to download`;
  }
  if (state.status === 'downloading') {
    const progress = typeof state.downloadPercent === 'number' ? ` (${Math.floor(state.downloadPercent)}%)` : '';
    return `Downloading update${progress}`;
  }
  if (state.status === 'downloaded') {
    return `Update ${state.downloadedVersion ?? state.availableVersion ?? 'ready'} downloaded. Click to restart and install.`;
  }
  if (state.status === 'error') {
    if (state.errorContext === 'download' && state.availableVersion) {
      return `Download failed for ${state.availableVersion}. Click to retry.`;
    }
    if (state.errorContext === 'install' && state.downloadedVersion) {
      return `Install failed for ${state.downloadedVersion}. Click to retry.`;
    }
    if (state.downloadedVersion) {
      return `Update ${state.downloadedVersion} downloaded. Click to restart and install.`;
    }
    return state.message ?? 'Update failed';
  }
  return 'Up to date';
}

export function canCheckForUpdate(state: UpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return state.status !== 'checking' && state.status !== 'downloading' && state.status !== 'disabled';
}

export function getUpdateDisabledReason(state: Pick<UpdateState, 'enabled' | 'status' | 'message'> | null): string | null {
  if (!state || (state.enabled && state.status !== 'disabled')) return null;
  return state.message?.trim() || 'Automatic updates are not available in this build.';
}

export function getUpdateIdleTooltip(state: Pick<UpdateState, 'enabled' | 'status' | 'message'> | null) {
  const disabledReason = getUpdateDisabledReason(state);
  return disabledReason
    ? { title: 'Updates unavailable', detail: disabledReason }
    : { title: 'Check for updates', detail: null };
}
