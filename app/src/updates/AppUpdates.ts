// The board app's updater: checks GitHub Releases 15 s after launch and every 4 minutes,
// downloads when the page asks, stops the board server and installs with quitAndInstall.
// Cut down from T3 Code's apps/desktop/src/updates/DesktopUpdates.ts, without remote
// updates and the install record.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type {
  UpdateActionResult,
  UpdateChannel,
  UpdateCheckResult,
  UpdateState,
} from "../../../board/src/app/board-app.ts";
import type { ElectronUpdater, ElectronUpdaterError } from "./ElectronUpdater.ts";
import { normalizeReleaseNotes } from "./releaseNotes.ts";
import * as Machine from "./updateMachine.ts";

export interface PollTimes {
  readonly startupDelay: Duration.Input;
  readonly pollInterval: Duration.Input;
}

const DEFAULT_POLL_TIMES: PollTimes = { startupDelay: Duration.seconds(15), pollInterval: Duration.minutes(4) };

type UpdateAction = "check" | "download" | "install" | "channel";

export class UpdateActionInProgressError extends Error {
  constructor(action: UpdateAction, channel: UpdateChannel) {
    super(`Cannot change the update channel to ${channel} while an update ${action} is in progress.`);
  }
}

/** Why the app can't update itself, or null when it can. */
export const disabledReason = (app: { readonly isPackaged: boolean; readonly hasFeedConfig: boolean }): string | null => {
  if (!app.isPackaged) return "Updates work only in the packaged app.";
  if (!app.hasFeedConfig) return "Updates are off because the app has no update feed.";
  return null;
};

/** The board server, which an install stops first, as T3 Code stops its backends. */
export interface BoardServerControl {
  /** Drains the server's writes and stops it. */
  readonly stop: Effect.Effect<void, Error>;
  /** Starts the server again after an install that failed. */
  readonly start: Effect.Effect<void>;
}

export interface AppUpdatesOptions {
  readonly updater: ElectronUpdater;
  readonly board: BoardServerControl;
  readonly version: string;
  readonly disabledReason: string | null;
  /** Called with each new state, to send it to the page. */
  readonly publish: (state: UpdateState) => void;
  readonly pollTimes?: PollTimes;
}

export interface AppUpdates {
  readonly getState: Effect.Effect<UpdateState>;
  readonly check: Effect.Effect<UpdateCheckResult>;
  readonly download: Effect.Effect<UpdateActionResult>;
  readonly install: Effect.Effect<UpdateActionResult>;
  readonly setChannel: (channel: UpdateChannel) => Effect.Effect<UpdateState, UpdateActionInProgressError>;
}

const now = () => new Date().toISOString();

const versionOf = (info: unknown): string | null => {
  const version = (info as { version?: unknown } | null)?.version;
  return typeof version === "string" ? version : null;
};

/**
 * Sets the updater up and starts the checks, which stop when the scope closes.
 * A disabled app never touches the updater and stays `disabled`.
 */
export const make = (options: AppUpdatesOptions): Effect.Effect<AppUpdates, never, Scope.Scope> =>
  Effect.gen(function* () {
    const { updater, board, version, publish } = options;
    const pollTimes = options.pollTimes ?? DEFAULT_POLL_TIMES;
    const enabled = options.disabledReason === null;
    let state = Machine.createBaseUpdateState(version, Machine.defaultChannel(version), options.disabledReason);
    let activeAction: UpdateAction | null = null;

    const setState = (next: UpdateState) => {
      // As T3 Code's updater log: each status change, with the version it concerns.
      if (next.status !== state.status) {
        const about = next.downloadedVersion ?? next.availableVersion ?? next.message;
        Effect.runSync(Effect.logInfo(`update ${next.status}${about ? `: ${about}` : ""}`));
      }
      state = next;
      publish(state);
    };
    const tryStart = (action: UpdateAction) => {
      if (activeAction !== null) return false;
      activeAction = action;
      return true;
    };
    const finish = (action: UpdateAction) =>
      Effect.sync(() => {
        if (activeAction === action) activeAction = null;
      });

    const applyChannel = (channel: UpdateChannel) =>
      Effect.gen(function* () {
        // As T3 Code: only nightly takes prereleases and may go back a version.
        const nightly = channel === "nightly";
        yield* updater.setChannel(channel);
        yield* updater.setAllowPrerelease(nightly);
        yield* updater.setAllowDowngrade(nightly);
        // Unlike T3 Code, which does this on nightly only, both channels show the changelog.
        yield* updater.setFullChangelog(true);
      });

    /** Checks the feed unless a download runs; `held` means the caller already holds the action. */
    const checkForUpdates = (reservation: "acquire" | "held" = "acquire") =>
      Effect.gen(function* () {
        if (!enabled || state.status === "downloading") return false;
        if (reservation === "acquire" && !tryStart("check")) return false;
        const check = Effect.gen(function* () {
          setState(Machine.reduceOnCheckStart(state, now()));
          yield* updater.checkForUpdates.pipe(
            Effect.catch((error: ElectronUpdaterError) =>
              Effect.sync(() => setState(Machine.reduceOnCheckFailure(state, error.message, now()))).pipe(
                Effect.andThen(Effect.logError(error.message)),
              ),
            ),
          );
          return true;
        });
        return yield* reservation === "held" ? check : check.pipe(Effect.ensuring(finish("check")));
      });

    const download = Effect.gen(function* () {
      if (!enabled || state.status !== "available" || !tryStart("download")) return false;
      setState(Machine.reduceOnDownloadStart(state));
      yield* updater.downloadUpdate.pipe(
        Effect.catch((error: ElectronUpdaterError) =>
          Effect.sync(() => setState(Machine.reduceOnDownloadFailure(state, error.message))).pipe(
            Effect.andThen(Effect.logError(error.message)),
          ),
        ),
        Effect.ensuring(finish("download")),
      );
      return true;
    });

    // Whether quitAndInstall has returned and the app waits to quit; on macOS a failure then comes as an `error` event.
    let quitting = false;
    const failInstall = (message: string) =>
      Effect.sync(() => void (quitting = false)).pipe(
        Effect.andThen(board.start),
        Effect.andThen(Effect.sync(() => setState(Machine.reduceOnInstallFailure(state, message)))),
        Effect.andThen(Effect.logError(message)),
        Effect.andThen(finish("install")),
      );

    // A successful install quits the app, so only a failure gives up the action.
    const install = Effect.gen(function* () {
      if (!enabled || state.status !== "downloaded" || !tryStart("install")) return false;
      setState(Machine.reduceOnInstallStart(state));
      yield* board.stop.pipe(
        Effect.andThen(updater.quitAndInstall({ isSilent: true, isForceRunAfter: true })),
        Effect.andThen(Effect.sync(() => void (quitting = true))),
        Effect.catch((error: Error) => failInstall(error.message)),
      );
      return true;
    });

    if (enabled) {
      yield* updater.setAutoDownload(false);
      yield* updater.setAutoInstallOnAppQuit(false);
      yield* applyChannel(state.channel);

      // electron-updater emits these while checkForUpdates and downloadUpdate run.
      yield* updater.on("update-available", (info) => {
        const available = versionOf(info);
        if (available === null) return;
        // A version of the other channel counts as no update, as T3 Code does.
        if (Machine.defaultChannel(available) !== state.channel) {
          setState(Machine.reduceOnNoUpdate(state, now()));
          return;
        }
        const releaseNotes = (info as { releaseNotes?: unknown }).releaseNotes;
        const notes = normalizeReleaseNotes(releaseNotes, available, state.channel);
        setState(
          Machine.reduceOnUpdateAvailable(state, available, now(), notes.releaseNotes, notes.omittedReleaseCount),
        );
      });
      yield* updater.on("update-not-available", () => setState(Machine.reduceOnNoUpdate(state, now())));
      yield* updater.on("download-progress", (progress) => {
        const percent = (progress as { percent?: unknown } | null)?.percent;
        if (typeof percent !== "number") return;
        if (Machine.shouldBroadcastDownloadProgress(state, percent) || state.message !== null) {
          setState(Machine.reduceOnDownloadProgress(state, percent));
        }
      });
      yield* updater.on("update-downloaded", (info) => {
        const downloaded = versionOf(info);
        if (downloaded !== null) setState(Machine.reduceOnDownloadComplete(state, downloaded));
      });
      // During an action its own failure handling sets the state, except for an install that waits to quit.
      yield* updater.on("error", (error) => {
        const message = (error instanceof Error ? error.message : String(error)).split("\n", 1)[0] ?? "";
        if (quitting) {
          Effect.runFork(failInstall(message));
          return;
        }
        if (activeAction !== null) return;
        setState(Machine.reduceOnBackgroundError(state, message, now()));
      });

      // The 4 minutes count from the first check, not from launch.
      yield* Effect.sleep(pollTimes.startupDelay).pipe(
        Effect.andThen(checkForUpdates()),
        Effect.andThen(
          Effect.sleep(pollTimes.pollInterval).pipe(Effect.andThen(checkForUpdates()), Effect.forever),
        ),
        Effect.forkScoped,
      );
    }
    publish(state);

    return {
      getState: Effect.sync(() => state),
      check: Effect.map(checkForUpdates(), (checked) => ({ checked, state })),
      download: Effect.map(download, (accepted) => ({ accepted, completed: accepted && state.status === "downloaded", state })),
      install: Effect.map(install, (accepted) => ({ accepted, completed: false, state })),
      setChannel: (channel) =>
        Effect.gen(function* () {
          if (activeAction !== null) return yield* Effect.fail(new UpdateActionInProgressError(activeAction, channel));
          if (channel === state.channel) return state;
          activeAction = "channel";
          return yield* Effect.gen(function* () {
            setState(Machine.createBaseUpdateState(version, channel, options.disabledReason));
            if (!enabled) return state;
            yield* applyChannel(channel);
            // Switching channels may offer a lower version once, as T3 Code allows.
            const allowDowngrade = yield* updater.allowDowngrade;
            yield* updater.setAllowDowngrade(true);
            yield* checkForUpdates("held").pipe(Effect.ensuring(updater.setAllowDowngrade(allowDowngrade)));
            return state;
          }).pipe(Effect.ensuring(finish("channel")));
        }),
    };
  });
