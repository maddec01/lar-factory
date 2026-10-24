// The board app's main process: starts the board server as a child with the login
// shell's PATH, shows its page in a window, starts the server again if it crashes,
// installs the bundled skills, removes the old launch agent, answers the settings
// screen's profile calls, checks Releases for updates, drains and stops the server
// before it installs one and stops the server when the app quits. Modelled on T3 Code's apps/desktop/src/main.ts and window/DesktopWindow.ts.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as Electron from "electron";

import * as BoardServer from "./backend/BoardServer.ts";
import * as BoardSupervisor from "./backend/BoardSupervisor.ts";
import * as ClaudeProfiles from "./backend/ClaudeProfiles.ts";
import * as LaunchAgentCleanup from "./backend/LaunchAgentCleanup.ts";
import * as SkillInstall from "./backend/SkillInstall.ts";
import * as ExternalLink from "./ExternalLink.ts";
import * as IpcChannels from "./ipcChannels.ts";
import * as LaunchSecret from "./LaunchSecret.ts";
import * as RestartDialog from "./RestartDialog.ts";
import * as ShellEnvironment from "./shell/ShellEnvironment.ts";
import * as StartingPage from "./StartingPage.ts";
import * as AppUpdates from "./updates/AppUpdates.ts";
import * as ChannelSetting from "./updates/ChannelSetting.ts";
import * as ElectronUpdater from "./updates/ElectronUpdater.ts";
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
  // A stopped server's page gets no secret, as after a crash.
  const forgetOrigin = Effect.sync(() => void (origin = ""));
  return { window, events, origin: () => origin, forgetOrigin, showStarting: load(StartingPage.url()) };
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

/** Throws for a call from any page but the current board server's, and while no server is ready. */
const boardPageOnly = (boardOrigin: () => string, refusal: string) => (event: Electron.IpcMainInvokeEvent) => {
  if (!ClaudeProfiles.fromBoard(event.senderFrame?.url, boardOrigin())) throw new Error(refusal);
};

/** The settings screen's calls: list the Claude profiles and tick or untick one by name. */
const handleProfiles = (boardOrigin: () => string) => {
  const checkSender = boardPageOnly(boardOrigin, "Only the board's page can change the Claude profiles");
  const home = SkillInstall.installHome(NodeOS.homedir(), process.env);
  Electron.ipcMain.handle(IpcChannels.LIST_PROFILES, (event) => {
    checkSender(event);
    return ClaudeProfiles.list(home);
  });
  Electron.ipcMain.handle(IpcChannels.SET_PROFILE_TICK, (event, name: unknown, ticked: unknown) => {
    checkSender(event);
    return ClaudeProfiles.setTick(home, name, ticked);
  });
};

/** The updater's calls, as T3 Code's update IPC handlers, and the dialog that asks before installing. */
const handleUpdates = (
  window: Electron.BrowserWindow,
  boardOrigin: () => string,
  updates: AppUpdates.AppUpdates,
) => {
  const checkSender = boardPageOnly(boardOrigin, "Only the board's page can use the app's updates");
  const handle = (channel: string, call: (...args: Array<unknown>) => Effect.Effect<unknown, Error>) =>
    Electron.ipcMain.handle(channel, (event, ...args) => {
      checkSender(event);
      return Effect.runPromise(call(...args));
    });
  handle(IpcChannels.UPDATE_GET_STATE, () => updates.getState);
  handle(IpcChannels.UPDATE_CHECK, () => updates.check);
  handle(IpcChannels.UPDATE_DOWNLOAD, () => updates.download);
  handle(IpcChannels.UPDATE_INSTALL, () => updates.install);
  handle(IpcChannels.UPDATE_SET_CHANNEL, (channel) =>
    channel === "latest" || channel === "nightly"
      ? updates.setChannel(channel)
      : Effect.fail(new Error("The update channel must be latest or nightly")),
  );
  handle(IpcChannels.CONFIRM_RESTART, (message) =>
    typeof message === "string"
      ? Effect.promise(() => Electron.dialog.showMessageBox(window, RestartDialog.options(message))).pipe(
          Effect.map(RestartDialog.confirmed),
        )
      : Effect.fail(new Error("The restart question must be a string")),
  );
};

/** Checks Releases for updates from now until the scope closes, telling the window each new state. */
const startUpdates = (window: Electron.BrowserWindow, board: AppUpdates.BoardServerControl) =>
  Effect.gen(function* () {
    const isPackaged = Electron.app.isPackaged;
    return yield* AppUpdates.make({
      updater: yield* Effect.promise(ElectronUpdater.make),
      board,
      version: Electron.app.getVersion(),
      // electron-builder writes the feed's app-update.yml beside app.asar.
      disabledReason: AppUpdates.disabledReason({
        isPackaged,
        hasFeedConfig: isPackaged && NodeFS.existsSync(NodePath.join(process.resourcesPath, "app-update.yml")),
      }),
      channelSetting: ChannelSetting.atFile(NodePath.join(Electron.app.getPath("userData"), "update-channel.json")),
      publish: (state) => {
        if (!window.isDestroyed()) window.webContents.send(IpcChannels.UPDATE_STATE, state);
      },
    });
  });

const program = Effect.gen(function* () {
  yield* Effect.promise(() => Electron.app.whenReady());
  // One secret per launch, shared by the restarted servers and the page.
  const secret = LaunchSecret.make();
  const board = openBoardWindow(secret);
  handleProfiles(board.origin);
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
  const supervisor = yield* BoardSupervisor.makeControl(BoardSupervisor.supervise(BoardServer.start(config), board.events));
  const http = yield* HttpClient.HttpClient;
  const stopBoard = Effect.suspend(() => {
    const origin = board.origin();
    // With no server ready there is no write to wait for.
    return origin ? BoardServer.drain(new URL(origin), secret) : Effect.void;
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.andThen(supervisor.stop),
    Effect.andThen(board.forgetOrigin),
  );
  // A failed drain leaves the server refusing writes, so the install's failure path restarts it.
  handleUpdates(board.window, board.origin, yield* startUpdates(board.window, {
    stop: stopBoard,
    start: supervisor.stop.pipe(Effect.andThen(supervisor.start)),
  }));
  yield* supervisor.start;
  // Starts after the board server. The copy is synchronous, so it blocks the main
  // process briefly after start.
  yield* Effect.forkScoped(installSkills);
  // The app replaces the launch agent that ran the board before it.
  yield* Effect.forkScoped(
    LaunchAgentCleanup.onLaunch({
      isPackaged: Electron.app.isPackaged,
      home: NodeOS.homedir(),
      uid: process.getuid?.() ?? NodeOS.userInfo().uid,
      launchctl: "/bin/launchctl",
    }),
  );
  yield* quitRequested;
}).pipe(
  Effect.scoped,
  Effect.provide([NodeHttpClient.layerUndici, NodeServices.layer]),
  Effect.ensuring(Effect.sync(() => Electron.app.exit(0))),
);

// One app at a time: a second launch hands over to the first (see "second-instance") and quits.
if (Electron.app.requestSingleInstanceLock()) NodeRuntime.runMain(program);
else Electron.app.quit();
