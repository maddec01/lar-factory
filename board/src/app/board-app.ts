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

export interface BoardAppBridge {
  platform: string;
  /** The per-launch secret the app's server wants on each guarded write. */
  secret?: string | undefined;
  listProfiles: () => Promise<ProfilesResult>;
  setProfileTick: (name: string, ticked: boolean) => Promise<ProfilesResult>;
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
