// The bridge between the main process and the board's page, as T3 Code's
// apps/desktop/src/preload.ts. The page can tell from it that it runs in the app,
// sends its secret with each write, the settings screen lists and ticks Claude
// profiles through it, it follows and drives the app's updates,
// and asks before restarting to install one (packages/shared/src/board-app.ts holds the bridge contract).
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import { contextBridge, ipcRenderer } from "electron";

import type { BoardAppBridge } from "@mux-factory/shared";
import * as IpcChannels from "./ipc-channels.ts";
import * as LaunchSecret from "./board-server/launch-secret.ts";

// The main process answers only the board's pages; any other page gets no secret.
const secret: unknown = ipcRenderer.sendSync(LaunchSecret.CHANNEL);

const bridge: BoardAppBridge = {
  platform: process.platform,
  ...(typeof secret === "string" && { secret }),
  listProfiles: () => ipcRenderer.invoke(IpcChannels.LIST_PROFILES),
  setProfileTick: (name, ticked) => ipcRenderer.invoke(IpcChannels.SET_PROFILE_TICK, name, ticked),
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE),
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IpcChannels.UPDATE_STATE, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE, wrappedListener);
    };
  },
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL),
  setUpdateChannel: (channel) => ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL, channel),
  confirmRestart: (message) => ipcRenderer.invoke(IpcChannels.CONFIRM_RESTART, message),
};

contextBridge.exposeInMainWorld("boardApp", bridge);
