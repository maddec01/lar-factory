// The bridge between the main process and the board's page, as T3 Code's
// apps/desktop/src/preload.ts. The page can tell from it that it runs in the app,
// sends its secret with each write, and the settings screen lists and ticks Claude
// profiles through it (board/src/app/board-app.ts reads the bridge).
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import { contextBridge, ipcRenderer } from "electron";

import type { BoardAppBridge } from "../../board/src/app/board-app.ts";
import { LIST_PROFILES, SET_PROFILE_TICK } from "./ipcChannels.ts";
import * as LaunchSecret from "./LaunchSecret.ts";

// The main process answers only the board's pages; any other page gets no secret.
const secret: unknown = ipcRenderer.sendSync(LaunchSecret.CHANNEL);

const bridge: BoardAppBridge = {
  platform: process.platform,
  ...(typeof secret === "string" && { secret }),
  listProfiles: () => ipcRenderer.invoke(LIST_PROFILES),
  setProfileTick: (name, ticked) => ipcRenderer.invoke(SET_PROFILE_TICK, name, ticked),
};

contextBridge.exposeInMainWorld("boardApp", bridge);
