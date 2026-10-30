// The bridge between the main process and the board's page, as T3 Code's
// apps/desktop/src/preload.ts. The page can tell from it that it runs in the app,
// sends its secret with each write, it follows the skill install and retries it, replaces Drift and ticks
// Install targets through it, it follows the window's full screen, it follows and drives the app's updates,
// and asks before restarting to install one (packages/shared/src/board-app.ts holds the bridge contract).
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import { contextBridge, ipcRenderer } from "electron";

import type { BoardAppBridge } from "@lar-factory/shared";
import * as IpcChannels from "./ipc-channels.ts";
import * as LaunchSecret from "./board-server/launch-secret.ts";

// The main process answers only the board's pages; any other page gets no secret.
const secret: unknown = ipcRenderer.sendSync(LaunchSecret.CHANNEL);

const bridge: BoardAppBridge = {
  platform: process.platform,
  ...(typeof secret === "string" && { secret }),
  boardReady: () => ipcRenderer.invoke(IpcChannels.INSTALL_BOARD_READY),
  getInstallState: () => ipcRenderer.invoke(IpcChannels.INSTALL_GET_STATE),
  onInstallState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, snapshot: unknown) => {
      if (typeof snapshot !== "object" || snapshot === null) return;
      listener(snapshot as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(IpcChannels.INSTALL_STATE, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.INSTALL_STATE, wrappedListener);
    };
  },
  closeInstallOverview: (reason, revision) => ipcRenderer.invoke(IpcChannels.INSTALL_CLOSE_OVERVIEW, reason, revision),
  retryInstall: () => ipcRenderer.invoke(IpcChannels.INSTALL_RETRY),
  replaceDrift: () => ipcRenderer.invoke(IpcChannels.INSTALL_REPLACE),
  setTargetTick: (path, ticked) => ipcRenderer.invoke(IpcChannels.INSTALL_SET_TICK, path, ticked),
  getWindowFullscreenState: () => ipcRenderer.sendSync(IpcChannels.GET_WINDOW_FULLSCREEN_STATE) === true,
  onWindowFullscreenStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => {
      if (typeof fullscreen !== "boolean") return;
      listener(fullscreen);
    };
    ipcRenderer.on(IpcChannels.WINDOW_FULLSCREEN_STATE, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.WINDOW_FULLSCREEN_STATE, wrappedListener);
    };
  },
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
