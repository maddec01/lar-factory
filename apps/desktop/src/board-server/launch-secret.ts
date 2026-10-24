// The secret the app makes on each launch. The board server refuses guarded writes
// without it (apps/server/src/server.ts); the page gets it through the preload bridge and
// sends it back in X-Board-Secret (packages/shared/src/board-app.ts). The preload asks the
// main process for it over IPC, so it never shows in a process's arguments.

import * as NodeCrypto from "node:crypto";

/** The channel the preload asks the main process for the secret on, with `ipcRenderer.sendSync`. */
export const CHANNEL = "board-app:secret";

/** 32 random bytes, base64url. */
export const make = (): string => NodeCrypto.randomBytes(32).toString("base64url");

/** What the main process answers a frame at `frameUrl`: the secret for the board's pages, null for any other. */
export const forFrame = (frameUrl: string, boardOrigin: string, secret: string): string | null =>
  URL.parse(frameUrl)?.origin === boardOrigin ? secret : null;
