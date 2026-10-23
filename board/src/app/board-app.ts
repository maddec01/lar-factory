// What the board app's preload bridge (app/src/preload.ts) hands the page. Outside the app,
// in a browser or `pnpm run sample`, there is no bridge.

export interface BoardAppBridge {
  platform: string;
  /** The per-launch secret the app's server wants on each guarded write. */
  secret?: string;
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
