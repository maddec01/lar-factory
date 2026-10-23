// The board app's main process: starts the board server as a child, shows its page
// in a window and stops the server when the app quits. Modelled on T3 Code's
// apps/desktop/src/main.ts and window/DesktopWindow.ts.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Electron from "electron";

import * as BoardServer from "./backend/BoardServer.ts";

/** Resolves once the user quits the app or closes its last window. */
const quitRequested = Effect.callback<void>((resume) => {
  const onBeforeQuit = (event: Electron.Event) => {
    // Hold the quit until the scope has stopped the server; the program exits after.
    event.preventDefault();
    resume(Effect.void);
  };
  const onAllClosed = () => resume(Effect.void);
  Electron.app.on("before-quit", onBeforeQuit);
  Electron.app.on("window-all-closed", onAllClosed);
  return Effect.sync(() => {
    Electron.app.off("before-quit", onBeforeQuit);
    Electron.app.off("window-all-closed", onAllClosed);
  });
});

const openWindow = (url: URL) =>
  Effect.promise(async () => {
    const window = new Electron.BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 840,
      minHeight: 620,
      title: "Mux Factory",
      webPreferences: {
        preload: NodePath.join(import.meta.dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Links to GitHub and elsewhere open in the browser; only the board stays in the window.
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      void Electron.shell.openExternal(target);
      return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, target) => {
      if (new URL(target).origin === url.origin) return;
      event.preventDefault();
      void Electron.shell.openExternal(target);
    });
    await window.loadURL(url.href);
    return window;
  });

const program = Effect.gen(function* () {
  yield* Effect.promise(() => Electron.app.whenReady());
  const boardDir = NodePath.resolve(Electron.app.getAppPath(), "../board");
  const board = yield* BoardServer.start(
    BoardServer.makeStartConfig({ executablePath: process.execPath, boardDir, env: process.env }),
  );
  const window = yield* openWindow(board.url);
  // Opening the app again brings this window forward; the second copy has already quit.
  Electron.app.on("second-instance", () => {
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  yield* quitRequested;
}).pipe(
  Effect.scoped,
  Effect.provide(NodeHttpClient.layerUndici),
  Effect.ensuring(Effect.sync(() => Electron.app.exit(0))),
);

// One app at a time: a second launch hands over to the first (see "second-instance") and quits.
if (Electron.app.requestSingleInstanceLock()) NodeRuntime.runMain(program);
else Electron.app.quit();
