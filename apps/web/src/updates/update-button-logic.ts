// Which action the update pill runs, copied from T3 Code's apps/web/src/components/desktopUpdate.logic.ts at
// 9a391eb, without the release URLs, the Intel build warning and the not-applied update, which the board app's
// state doesn't have. The pill's states and its words are the board's.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import type { UpdateActionResult, UpdateState } from '@lar-factory/shared';

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

/** The title bar's update pill: hidden with no update, then available, downloading, and ready to restart. A background
 *  check keeps a downloaded update's pill, which does nothing until the check ends. */
export type UpdatePill = 'none' | 'available' | 'downloading' | 'ready';

export function resolveUpdatePill(state: UpdateState | null): UpdatePill {
  if (!state) return 'none';
  if (state.status === 'downloading') return 'downloading';
  const action = resolveUpdateButtonAction(state);
  if (action === 'install' || (state.status === 'checking' && state.downloadedVersion)) return 'ready';
  return action === 'download' ? 'available' : 'none';
}

/** A download's whole percentage, 0 before the app reports one. */
export function downloadPercent(state: Pick<UpdateState, 'downloadPercent'>): number {
  const percent = state.downloadPercent;
  if (percent === null || !Number.isFinite(percent)) return 0;
  return Math.floor(Math.min(100, Math.max(0, percent)));
}

/** What the updater last found, in words: Settings › Updates' status and the changelog's heading. */
export function updateStatusText(state: UpdateState): string {
  // A failed download or install keeps its update available or downloaded, with the error.
  if ((state.errorContext === 'download' || state.errorContext === 'install') && state.message !== null) {
    const verb = state.errorContext === 'install' ? 'install' : 'download';
    return `Couldn't ${verb} ${state.downloadedVersion ?? state.availableVersion}: ${state.message}`;
  }
  switch (state.status) {
    case 'disabled': case 'error': return state.message ?? '';
    case 'idle': return '';
    case 'checking': return 'Checking for updates…';
    case 'up-to-date': return `Up to date on ${state.currentVersion}.`;
    case 'available': return `${state.availableVersion} is available.`;
    case 'downloading': return `Downloading ${state.availableVersion}… ${downloadPercent(state)}%`;
    case 'downloaded': return `${state.downloadedVersion} is ready to install.`;
  }
}

/** The board's wording, not T3's running-tasks warning. */
export function getUpdateInstallConfirmationMessage(state: Pick<UpdateState, 'availableVersion' | 'downloadedVersion'>): string {
  const version = state.downloadedVersion ?? state.availableVersion;
  return `The board app will restart to install${version ? ` ${version}` : ' the update'}.`;
}

export function getUpdateActionError(result: UpdateActionResult): string | null {
  if (!result.accepted || result.completed) return null;
  if (typeof result.state.message !== 'string') return null;
  const message = result.state.message.trim();
  return message.length > 0 ? message : null;
}

export function canCheckForUpdate(state: UpdateState | null): boolean {
  if (!state || !state.enabled) return false;
  return state.status !== 'checking' && state.status !== 'downloading' && state.status !== 'disabled';
}

export function getUpdateDisabledReason(state: Pick<UpdateState, 'enabled' | 'status' | 'message'> | null): string | null {
  if (!state || (state.enabled && state.status !== 'disabled')) return null;
  return state.message?.trim() || 'Automatic updates are not available in this build.';
}
