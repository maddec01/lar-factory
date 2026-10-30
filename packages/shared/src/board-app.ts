// What the board app's preload bridge (apps/desktop/src/preload.ts) hands the page. Outside the app,
// in a browser or `pnpm run sample`, there is no bridge, so whatever needs it doesn't show there.

import type { InstallOperationResult, InstallSnapshot } from './install-snapshot.ts';

/** Where the app looks for updates: `nightly-mac.yml` or `latest-mac.yml` on the Releases. */
export type UpdateChannel = 'latest' | 'nightly';

/** T3 Code's update states. An unpackaged dev app is `disabled`. */
export type UpdateStatus =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error';

/** One Release's changes: its last `items` of `totalItems`, newest first. */
export interface UpdateReleaseNote {
  version: string;
  items: readonly string[];
  totalItems: number;
}

/** What the app's updater knows, as T3 Code's `DesktopUpdateState`. */
export interface UpdateState {
  enabled: boolean;
  status: UpdateStatus;
  channel: UpdateChannel;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  /** The changes of the Releases between the running version and the available one, newest first. */
  releaseNotes: readonly UpdateReleaseNote[];
  /** Releases with changes that `releaseNotes` leaves out. */
  omittedReleaseCount: number;
  downloadPercent: number | null;
  /** ISO time of the last check. */
  checkedAt: string | null;
  /** Why updates are disabled, or the last error. */
  message: string | null;
  errorContext: 'check' | 'download' | 'install' | null;
  canRetry: boolean;
}

/** Whether the app took a download or install request, and the state after it. */
export interface UpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: UpdateState;
}

export interface UpdateCheckResult {
  checked: boolean;
  state: UpdateState;
}

export interface BoardAppBridge {
  platform: string;
  /** The per-launch secret the app's server wants on each guarded write. */
  secret?: string | undefined;
  /** The loading screen has left and the notification stack can show installation. Safe to repeat. */
  boardReady: () => Promise<void>;
  /** The skills' install state now. */
  getInstallState: () => Promise<InstallSnapshot>;
  /** Calls `listener` with each new install state; the returned function stops it. */
  onInstallState: (listener: (snapshot: InstallSnapshot) => void) => () => void;
  /** Checks the skills again, retrying each failed target. */
  retryInstall: () => Promise<InstallOperationResult>;
  /** Overwrites the Drift the last check found with the app's Release. */
  replaceDrift: () => Promise<InstallOperationResult>;
  /** Ticks or unticks the Install target at `path`, as the snapshot names it, then checks the skills. */
  setTargetTick: (path: string, ticked: boolean) => Promise<InstallOperationResult>;
  /** Whether the window is in full screen, read at once, as T3 Code's. */
  getWindowFullscreenState: () => boolean;
  /** Calls `listener` as the window enters and leaves macOS full screen; the returned function stops it. */
  onWindowFullscreenStateChange: (listener: (fullscreen: boolean) => void) => () => void;
  getUpdateState: () => Promise<UpdateState>;
  /** Calls `listener` with each new update state; the returned function stops it. */
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  checkForUpdate: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateActionResult>;
  installUpdate: () => Promise<UpdateActionResult>;
  setUpdateChannel: (channel: UpdateChannel) => Promise<UpdateState>;
  /** Asks `message` in a native dialog with Restart and Cancel; true if the user chose Restart. */
  confirmRestart: (message: string) => Promise<boolean>;
}

declare global {
  interface Window {
    boardApp?: BoardAppBridge;
  }
}

/** The app's bridge, or undefined outside the app. */
export const boardApp = (): BoardAppBridge | undefined => window.boardApp;

/** Headers for a JSON write: in the app they carry the secret the server checks. */
export function writeHeaders(): Record<string, string> {
  const secret = boardApp()?.secret;
  return { 'Content-Type': 'application/json', ...(secret && { 'X-Board-Secret': secret }) };
}

/** Whether the page runs in the Mac app, whose window leaves its title bar to the page. */
export const inMacApp = (): boolean => boardApp()?.platform === 'darwin';
