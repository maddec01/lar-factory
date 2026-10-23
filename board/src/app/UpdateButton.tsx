// The header's update button, shown once the app's updater finds a newer Release: Update downloads it
// with progress, then Install and restart quits into it. A failed download or install shows with a retry.
// It shows the states T3 Code's update button shows.

import { useEffect } from 'react';
import { boardApp, type UpdateState } from './board-app.ts';
import { useUpdateStore } from './update-store.ts';

interface UpdateAction { label: string; run?: () => unknown; title?: string; tone?: 'error' }

/** What the button shows and does in `state`, or null when it doesn't show. */
function actionFor(state: UpdateState): UpdateAction | null {
  const bridge = boardApp()!;
  const version = state.downloadedVersion ?? state.availableVersion;
  // A failed download keeps the update available and a failed install keeps it downloaded, with the error.
  if ((state.errorContext === 'download' || state.errorContext === 'install') && state.message !== null) {
    const install = state.errorContext === 'install';
    return {
      label: 'Update failed, retry',
      run: state.canRetry ? (install ? bridge.installUpdate : bridge.downloadUpdate) : undefined,
      title: `Couldn't ${install ? 'install' : 'download'} ${version}: ${state.message}`,
      tone: 'error',
    };
  }
  switch (state.status) {
    case 'available':
      return { label: `Update to ${version}`, run: bridge.downloadUpdate };
    case 'downloading':
      return { label: `Downloading ${Math.floor(state.downloadPercent ?? 0)}%` };
    case 'downloaded':
      return { label: 'Install and restart', run: bridge.installUpdate, title: `Quits and opens ${version}.` };
    // A failed check has no update to show; the next check tries again.
    default:
      return null;
  }
}

export function UpdateButton() {
  const { state, follow } = useUpdateStore();
  useEffect(follow, [follow]);
  const action = state && actionFor(state);
  if (!action) return null;
  const { label, run, title, tone } = action;
  // Busy rather than disabled while it downloads, so focus stays on the button.
  return (
    <button type="button" className="copy update-button" title={title} data-tone={tone} aria-disabled={!run}
      onClick={() => run && void run()}>
      {label}
    </button>
  );
}
