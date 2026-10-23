// What the board app's preload bridge (app/src/preload.ts) hands the page. Outside the app,
// in a browser or `pnpm run sample`, there is no bridge, so whatever needs it doesn't show there.

import type { ClaudeProfile, TickResult } from '../install-skills.ts';

/** The Claude profiles after a call, with what the last tick left alone and removed, or why it failed. */
export interface ProfilesResult {
  profiles: ClaudeProfile[];
  /** False until the app first installs its skills; until then no tick can change. */
  installed: boolean;
  /** Paths in the home, as `~/…`. */
  conflicts: string[];
  removed?: TickResult['removed'];
  error?: string;
}

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
  listProfiles: () => Promise<ProfilesResult>;
  setProfileTick: (name: string, ticked: boolean) => Promise<ProfilesResult>;
  getUpdateState: () => Promise<UpdateState>;
  /** Calls `listener` with each new update state; the returned function stops it. */
  onUpdateState: (listener: (state: UpdateState) => void) => () => void;
  checkForUpdate: () => Promise<UpdateCheckResult>;
  downloadUpdate: () => Promise<UpdateActionResult>;
  installUpdate: () => Promise<UpdateActionResult>;
  setUpdateChannel: (channel: UpdateChannel) => Promise<UpdateState>;
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
