// The board app's main process: starts the board server as a child with the login
// shell's PATH, shows its page in a window, starts the server again if it crashes,
// checks the bundled skills at launch and before each Start build, removes the old
// launch agent, answers the settings screen's profile calls, checks Releases for updates, drains and stops the server
// before it installs one and stops the server when the app quits. Modelled on T3 Code's apps/desktop/src/main.ts and window/DesktopWindow.ts.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import * as Electron from "electron";

import * as BoardServer from "./board-server/BoardServer.ts";
import * as BoardSupervisor from "./board-server/BoardSupervisor.ts";
import * as ClaudeProfiles from "./skills/claude-profiles.ts";
import * as LaunchAgentCleanup from "./launch-agent/launch-agent-cleanup.ts";
import * as SkillInstall from "./skills/skill-install.ts";
import * as T3Instances from "./skills/t3-instances.ts";
import * as ExternalLink from "./window/external-link.ts";
import * as MainWindowBounds from "./window/MainWindowBounds.ts";
import * as IpcChannels from "./ipc-channels.ts";
import * as LaunchSecret from "./board-server/launch-secret.ts";
import * as RestartDialog from "./updates/restart-dialog.ts";
import * as ShellEnvironment from "./shell-environment/ShellEnvironment.ts";
import * as StartingPage from "./window/starting-page.ts";
import * as WindowBackground from "./window/window-background.ts";
import * as AppUpdates from "./updates/AppUpdates.ts";
import * as ChannelSetting from "./updates/channel-setting.ts";
import * as ElectronUpdater from "./updates/ElectronUpdater.ts";
import * as WindowTitleBar from "./window/WindowTitleBar.ts";

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

/** Opens a web link in the browser and a T3 Code link in T3 Code; any other link opens nothing. */
const openOutside = (target: string) => {
  const url = ExternalLink.outsideUrl(target);
  if (url) void Electron.shell.openExternal(url);
};

const createWindow = (boardOrigin: () => string, secret: string) => {
  const setting = MainWindowBounds.atFile(NodePath.join(Electron.app.getPath("userData"), "window-state.json"));
  const persisted = Effect.runSync(setting.read);
  const displays = Electron.screen.getAllDisplays().map((display) => display.bounds);
  const bounds = MainWindowBounds.resolveInitialMainWindowBounds(persisted.mainWindowBounds, displays);
  const window = new Electron.BrowserWindow({
    ...bounds,
    minWidth: MainWindowBounds.MIN_MAIN_WINDOW_SIZE.width,
    minHeight: MainWindowBounds.MIN_MAIN_WINDOW_SIZE.height,
    title: "Lar Factory",
    // The design system's background, so no white shows before a page paints or between the pages.
    backgroundColor: WindowBackground.color(Electron.nativeTheme.shouldUseDarkColors),
    // Shown once the first page paints, already maximized if restoring that, so it doesn't open small and then grow.
    show: false,
    ...WindowTitleBar.options(process.platform),
    webPreferences: {
      preload: NodePath.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const followTheme = () => window.setBackgroundColor(WindowBackground.color(Electron.nativeTheme.shouldUseDarkColors));
  Electron.nativeTheme.on("updated", followTheme);
  window.once("closed", () => Electron.nativeTheme.off("updated", followTheme));
  window.once("ready-to-show", () => {
    // A window whose saved bounds no longer fit a display opens as a new one, not maximized.
    if (persisted.mainWindowMaximized && bounds === persisted.mainWindowBounds) window.maximize();
    window.show();
  });
  // Quitting holds in before-quit and then exits, so the window gets no close event to save on.
  Electron.app.on("before-quit", MainWindowBounds.persistMainWindowBounds(window, setting));
  window.webContents.ipc.on(LaunchSecret.CHANNEL, (event) => {
    event.returnValue = LaunchSecret.forFrame(event.senderFrame?.url ?? "", boardOrigin(), secret);
  });
  // While macOS full screen hides the traffic lights, the page moves its top-left controls into their place.
  window.webContents.ipc.on(IpcChannels.GET_WINDOW_FULLSCREEN_STATE, (event) => {
    event.returnValue = window.isFullScreen();
  });
  if (process.platform === "darwin") {
    window.on("enter-full-screen", () => window.webContents.send(IpcChannels.WINDOW_FULLSCREEN_STATE, true));
    window.on("leave-full-screen", () => window.webContents.send(IpcChannels.WINDOW_FULLSCREEN_STATE, false));
  }
  // Links to GitHub and elsewhere open in the browser, and thread links in T3 Code; only the board stays in the window.
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    openOutside(target);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (ExternalLink.isOn(target, boardOrigin())) return;
    event.preventDefault();
    openOutside(target);
  });
  return window;
};

/**
 * Opens the window at once on the starting page, and loads each ready server's page in it.
 * Until the board first shows, the starting page names the launch step and says why its server isn't up yet,
 * without reloading, so its mark draws once. The board's page opens on the drawn mark.
 */
const openBoardWindow = (secret: string) => {
  let origin = "";
  let boardShown = false;
  // Bumped by each ready server and each stop, so a load that waits on the mark's draw is skipped once either comes.
  let generation = 0;
  // When the starting page finished loading, which is when its mark starts to draw.
  let startingShownAt: number | undefined;
  const window = createWindow(() => origin, secret);
  const load = (href: string) =>
    Effect.tryPromise(() => window.loadURL(href)).pipe(
      Effect.catch((error) => Effect.logError(`could not load ${href.slice(0, 100)}: ${String(error)}`)),
    );
  // Runs a message in the starting page, which the board's page replaces: after that nothing is sent.
  const tell = (script: string) => {
    if (boardShown || window.isDestroyed()) return;
    window.webContents.executeJavaScript(script).catch((error: unknown) => {
      console.error(`could not update the starting page: ${String(error)}`);
    });
  };
  const events: BoardSupervisor.SupervisorEvents = {
    onReady: (url) =>
      Effect.suspend(() => {
        const mine = ++generation;
        // The board's page is held for the tool check, so the starting page stays up while it loads.
        tell(StartingPage.stepScript(StartingPage.STEPS.tools));
        // The board's page opens on a finished mark, so the first one waits out the draw. A restart's reload
        // replaces a board page, which drew long ago.
        const wait = boardShown ? 0 : StartingPage.drawWait(startingShownAt, Date.now());
        // Forked, so the supervisor watches the server's exit while the load waits.
        return Effect.sleep(Duration.millis(wait)).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              if (mine !== generation) return Effect.void;
              origin = url.origin;
              boardShown = true;
              return load(StartingPage.boardUrl(url));
            }),
          ),
          Effect.forkDetach,
          Effect.asVoid,
        );
      }),
    onRestart: (reason) =>
      Effect.suspend(() => {
        // The old server is gone: no page gets the secret until the next one is ready.
        generation += 1;
        origin = "";
        tell(StartingPage.errorScript(reason));
        return Effect.void;
      }),
  };
  const progress = (step: BoardServer.StartStep) =>
    tell(StartingPage.stepScript(step === "starting" ? StartingPage.STEPS.server : StartingPage.STEPS.healthz));
  // A stopped server's page gets no secret, as after a crash.
  const forgetOrigin = Effect.sync(() => {
    generation += 1;
    origin = "";
  });
  const showStarting = load(StartingPage.url()).pipe(
    Effect.tap(() => Effect.sync(() => void (startingShownAt = Date.now()))),
  );
  return { window, events, progress, origin: () => origin, forgetOrigin, showStarting };
};

/**
 * The launch's skill checks, or undefined when this run checks nothing: a dev run without the install flag. `env` is
 * the login shell's environment, which finds the `t3` CLI.
 */
const makeSkillChecks = (env: Record<string, string | undefined>) =>
  SkillInstall.makeChecks({
    isPackaged: Electron.app.isPackaged,
    version: Electron.app.getVersion(),
    home: NodeOS.homedir(),
    bundle: SkillInstall.locateBundle(Electron.app.getAppPath(), Electron.app.isPackaged),
    argv: process.argv,
    env: process.env,
  }, T3Instances.discover(env, NodeOS.homedir()));

/**
 * Checks the skills in the fallback targets at launch, then asks T3 until it answers and checks its targets. The board's
 * page reports what each check found, Drift, Clashes and failures, in its notices; a native dialog would hold the main
 * process on macOS and keep the window on the starting page.
 */
const checkSkillsAtLaunch = (checks: SkillInstall.Checks) =>
  checks.atLaunch.pipe(
    Effect.ignore,
    Effect.andThen(SkillInstall.discoverUntilAnswered(checks, SkillInstall.REDISCOVER_EVERY)),
  );

/** Throws for a call from any page but the current board server's, and while no server is ready. */
const boardPageOnly = (boardOrigin: () => string, refusal: string) => (event: Electron.IpcMainInvokeEvent) => {
  if (!ClaudeProfiles.fromBoard(event.senderFrame?.url, boardOrigin())) throw new Error(refusal);
};

/** The settings screen's calls: list the Claude profiles and tick or untick one by name. */
const handleProfiles = (boardOrigin: () => string) => {
  const checkSender = boardPageOnly(boardOrigin, "Only the board's page can change the Claude profiles");
  const home = SkillInstall.installHome(NodeOS.homedir(), process.env);
  const root = SkillInstall.installRoot(process.env);
  Electron.ipcMain.handle(IpcChannels.LIST_PROFILES, (event) => {
    checkSender(event);
    return ClaudeProfiles.list(home);
  });
  Electron.ipcMain.handle(IpcChannels.SET_PROFILE_TICK, (event, name: unknown, ticked: unknown) => {
    checkSender(event);
    return ClaudeProfiles.setTick(home, name, ticked, root);
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
  // One pair of checks for the whole run, so the launch's check and each Start build's take turns.
  const skillChecks = yield* makeSkillChecks(env);
  const config = BoardServer.makeStartConfig({
    ...BoardServer.locate(Electron.app.getAppPath(), Electron.app.isPackaged),
    executablePath: process.execPath,
    env,
    secret,
    checksSkills: skillChecks !== undefined,
  });
  const checkSkills = skillChecks && (() => Effect.runPromise(skillChecks.beforeBuild.pipe(Effect.match({
    onFailure: SkillInstall.buildRefusal,
    onSuccess: SkillInstall.buildRefusal,
  }))));
  // Quitting closes the scope, which stops the server or cancels a pending restart.
  const supervisor = yield* BoardSupervisor.makeControl(
    BoardSupervisor.supervise(BoardServer.start(config, { checkSkills, progress: board.progress }), board.events),
  );
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
  if (skillChecks) yield* Effect.forkScoped(checkSkillsAtLaunch(skillChecks));
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

// The app menu's About, Hide and Quit items read app.name. Electron derives userData
// from the name, so pin it first: update-channel.json, window-state.json, .updaterId and the
// single-instance lock stay in the package's folder, whatever the shown name.
Electron.app.setPath("userData", NodePath.join(Electron.app.getPath("appData"), "@lar-factory/desktop"));
Electron.app.setName("Lar Factory");

// One app at a time: a second launch hands over to the first (see "second-instance") and quits.
if (Electron.app.requestSingleInstanceLock()) NodeRuntime.runMain(program);
else Electron.app.quit();
