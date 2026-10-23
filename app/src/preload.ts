// The bridge between the main process and the board's page, as T3 Code's
// apps/desktop/src/preload.ts. The page can tell from it that it runs in the app, and
// sends its secret with each write (board/src/app/board-app.ts reads the bridge).
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import { contextBridge, ipcRenderer } from "electron";

import * as LaunchSecret from "./LaunchSecret.ts";

// The main process answers only the board's pages; any other page gets no secret.
const secret: unknown = ipcRenderer.sendSync(LaunchSecret.CHANNEL);

contextBridge.exposeInMainWorld("boardApp", {
  platform: process.platform,
  ...(typeof secret === "string" && { secret }),
});
