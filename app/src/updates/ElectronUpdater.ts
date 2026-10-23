// A thin wrapper around electron-updater's autoUpdater, copied from T3 Code's
// apps/desktop/src/electron/ElectronUpdater.ts as a plain interface, without the feed URL
// and differential download setters. Tests pass a fake in its place.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

import type { UpdateChannel } from "../../../board/src/app/board-app.ts";

export class ElectronUpdaterError extends Data.TaggedError("ElectronUpdaterError")<{
  readonly operation: "check" | "download" | "install";
  readonly cause: unknown;
}> {
  override get message(): string {
    const reason = this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Could not ${this.operation} the update: ${reason.split("\n", 1)[0]}`;
  }
}

/** The updater events the app listens to. */
export type UpdaterEvent =
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

export interface ElectronUpdater {
  readonly setAutoDownload: (value: boolean) => Effect.Effect<void>;
  readonly setAutoInstallOnAppQuit: (value: boolean) => Effect.Effect<void>;
  readonly setChannel: (channel: UpdateChannel) => Effect.Effect<void>;
  readonly setAllowPrerelease: (value: boolean) => Effect.Effect<void>;
  /** On, an update's `releaseNotes` hold every newer Release's notes rather than the new one's. */
  readonly setFullChangelog: (value: boolean) => Effect.Effect<void>;
  readonly allowDowngrade: Effect.Effect<boolean>;
  readonly setAllowDowngrade: (value: boolean) => Effect.Effect<void>;
  readonly checkForUpdates: Effect.Effect<void, ElectronUpdaterError>;
  readonly downloadUpdate: Effect.Effect<void, ElectronUpdaterError>;
  readonly quitAndInstall: (options: {
    readonly isSilent: boolean;
    readonly isForceRunAfter: boolean;
  }) => Effect.Effect<void, ElectronUpdaterError>;
  /** Listens to `eventName` until the scope closes. */
  readonly on: (eventName: UpdaterEvent, listener: (arg: unknown) => void) => Effect.Effect<void, never, Scope.Scope>;
}

/** The real updater. electron-updater is loaded on first use, so tests never load Electron. */
export const make = async (): Promise<ElectronUpdater> => {
  const { autoUpdater } = await import("electron-updater");
  const events = autoUpdater as unknown as {
    on: (eventName: string, listener: (arg: unknown) => void) => void;
    removeListener: (eventName: string, listener: (arg: unknown) => void) => void;
  };
  const set = (apply: () => void) => Effect.sync(apply);
  return {
    setAutoDownload: (value) => set(() => (autoUpdater.autoDownload = value)),
    setAutoInstallOnAppQuit: (value) => set(() => (autoUpdater.autoInstallOnAppQuit = value)),
    setChannel: (channel) => set(() => (autoUpdater.channel = channel)),
    setAllowPrerelease: (value) => set(() => (autoUpdater.allowPrerelease = value)),
    setFullChangelog: (value) => set(() => (autoUpdater.fullChangelog = value)),
    allowDowngrade: Effect.sync(() => autoUpdater.allowDowngrade),
    setAllowDowngrade: (value) => set(() => (autoUpdater.allowDowngrade = value)),
    checkForUpdates: Effect.tryPromise({
      try: () => autoUpdater.checkForUpdates(),
      catch: (cause) => new ElectronUpdaterError({ operation: "check", cause }),
    }).pipe(Effect.asVoid),
    downloadUpdate: Effect.tryPromise({
      try: () => autoUpdater.downloadUpdate(),
      catch: (cause) => new ElectronUpdaterError({ operation: "download", cause }),
    }).pipe(Effect.asVoid),
    quitAndInstall: ({ isSilent, isForceRunAfter }) =>
      Effect.try({
        try: () => autoUpdater.quitAndInstall(isSilent, isForceRunAfter),
        catch: (cause) => new ElectronUpdaterError({ operation: "install", cause }),
      }),
    on: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => events.on(eventName, listener)),
        () => Effect.sync(() => events.removeListener(eventName, listener)),
      ),
  };
};
