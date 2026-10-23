// The board app's main process: starts the board server as a child with the login
// shell's PATH, shows its page in a window, starts the server again if it crashes,
// installs the bundled skills and stops the server when the app quits. Modelled on
// T3 Code's apps/desktop/src/main.ts and window/DesktopWindow.ts.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Electron from "electron";

import * as BoardServer from "./backend/BoardServer.ts";
import * as BoardSupervisor from "./backend/BoardSupervisor.ts";
import * as SkillInstall from "./backend/SkillInstall.ts";
import * as ExternalLink from "./ExternalLink.ts";
import * as LaunchSecret from "./LaunchSecret.ts";
import * as ShellEnvironment from "./shell/ShellEnvironment.ts";
import * as StartingPage from "./StartingPage.ts";
import * as WindowTitleBar from "./WindowTitleBar.ts";

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

/** Opens a web link in the browser; any other link opens nothing. */
const openInBrowser = (target: string) => {
  const url = ExternalLink.browserUrl(target);
  if (url) void Electron.shell.openExternal(url);
};

const createWindow = (boardOrigin: () => string, secret: string) => {
  const window = new Electron.BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 840,
    minHeight: 620,
    title: "Mux Factory",
    ...WindowTitleBar.options(process.platform),
    webPreferences: {
      preload: NodePath.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.ipc.on(LaunchSecret.CHANNEL, (event) => {
    event.returnValue = LaunchSecret.forFrame(event.senderFrame?.url ?? "", boardOrigin(), secret);
  });
  // Links to GitHub and elsewhere open in the browser; only the board stays in the window.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openInBrowser(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (ExternalLink.isOn(target, boardOrigin())) return;
    event.preventDefault();
    openInBrowser(target);
  });
  return window;
};

/**
 * Opens the window at once on the starting page, and loads each ready server's page in it.
 * Until the board first shows, the starting page says why its server isn't up yet.
 */
const openBoardWindow = (secret: string) => {
  let origin = "";
  let boardShown = false;
  const window = createWindow(() => origin, secret);
  const load = (href: string) =>
    Effect.tryPromise(() => window.loadURL(href)).pipe(
      Effect.catch((error) => Effect.logError(`could not load ${href.slice(0, 100)}: ${String(error)}`)),
    );
  const events: BoardSupervisor.SupervisorEvents = {
    onReady: (url) =>
      Effect.suspend(() => {
        origin = url.origin;
        boardShown = true;
        return load(url.href);
      }),
    onRestart: (reason) =>
      Effect.suspend(() => {
        // The old server is gone: no page gets the secret until the next one is ready.
        origin = "";
        return boardShown ? Effect.void : load(StartingPage.url(reason));
      }),
  };
  return { window, events, showStarting: load(StartingPage.url()) };
};

/** Installs the bundled skills and shows the user an error or conflicts. */
const installSkills = SkillInstall.onLaunch({
  isPackaged: Electron.app.isPackaged,
  version: Electron.app.getVersion(),
  home: NodeOS.homedir(),
  bundle: SkillInstall.locateBundle(Electron.app.getAppPath(), Electron.app.isPackaged),
  argv: process.argv,
  env: process.env,
}).pipe(
  Effect.match({ onFailure: SkillInstall.notice, onSuccess: (result) => result && SkillInstall.notice(result) }),
  Effect.flatMap((notice) =>
    notice ? Effect.promise(() => Electron.dialog.showMessageBox({ ...notice, buttons: ["OK"] })) : Effect.void,
  ),
);

const program = Effect.gen(function* () {
  yield* Effect.promise(() => Electron.app.whenReady());
  // One secret per launch, shared by the restarted servers and the page.
  const secret = LaunchSecret.make();
  const board = openBoardWindow(secret);
  // Opening the app again brings this window forward; the second copy has already quit.
  Electron.app.on("second-instance", () => {
    if (board.window.isMinimized()) board.window.restore();
    board.window.focus();
  });
  yield* board.showStarting;
  // Read once: a restarted server keeps the PATH the first one got.
  const env = yield* ShellEnvironment.childEnvironment(process.env);
  const config = BoardServer.makeStartConfig({
    ...BoardServer.locate(Electron.app.getAppPath()),
    executablePath: process.execPath,
    env,
    secret,
  });
  // Quitting closes the scope, which stops the server or cancels a pending restart.
  yield* BoardSupervisor.supervise(BoardServer.start(config), board.events).pipe(Effect.forkScoped);
  // Starts after the board server. The copy is synchronous, so it blocks the main
  // process briefly after start.
  yield* Effect.forkScoped(installSkills);
  yield* quitRequested;
}).pipe(
  Effect.scoped,
  Effect.provide([NodeHttpClient.layerUndici, NodeServices.layer]),
  Effect.ensuring(Effect.sync(() => Electron.app.exit(0))),
);

// One app at a time: a second launch hands over to the first (see "second-instance") and quits.
if (Electron.app.requestSingleInstanceLock()) NodeRuntime.runMain(program);
else Electron.app.quit();
