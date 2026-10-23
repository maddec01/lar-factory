import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";

import type { UpdateState } from "../../../board/src/app/board-app.ts";
import * as AppUpdates from "./AppUpdates.ts";
import { ElectronUpdaterError, type ElectronUpdater, type UpdaterEvent } from "./ElectronUpdater.ts";
import * as Machine from "./updateMachine.ts";

/** What a check, download or install of the fake updater does: emit events, fail, or wait. */
type Step = Effect.Effect<void, ElectronUpdaterError>;

/** An updater that records its settings and calls, and emits events as the test says. */
const makeFakeUpdater = () => {
  const listeners = new Map<UpdaterEvent, Set<(arg: unknown) => void>>();
  const fake = {
    channel: "" as string,
    allowPrerelease: false,
    allowDowngrade: false,
    autoDownload: true,
    checks: 0,
    installs: 0,
    onCheck: Effect.void as Step,
    onDownload: Effect.void as Step,
    onInstall: Effect.void as Step,
    emit: (eventName: UpdaterEvent, arg?: unknown) => {
      for (const listener of listeners.get(eventName) ?? []) listener(arg);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
  const updater: ElectronUpdater = {
    setAutoDownload: (value) => Effect.sync(() => void (fake.autoDownload = value)),
    setAutoInstallOnAppQuit: () => Effect.void,
    setChannel: (channel) => Effect.sync(() => void (fake.channel = channel)),
    setAllowPrerelease: (value) => Effect.sync(() => void (fake.allowPrerelease = value)),
    allowDowngrade: Effect.sync(() => fake.allowDowngrade),
    setAllowDowngrade: (value) => Effect.sync(() => void (fake.allowDowngrade = value)),
    checkForUpdates: Effect.suspend(() => {
      fake.checks += 1;
      return fake.onCheck;
    }),
    downloadUpdate: Effect.suspend(() => fake.onDownload),
    quitAndInstall: () =>
      Effect.suspend(() => {
        fake.installs += 1;
        return fake.onInstall;
      }),
    on: (eventName, listener) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const set = listeners.get(eventName) ?? new Set();
          set.add(listener);
          listeners.set(eventName, set);
        }),
        () => Effect.sync(() => void listeners.get(eventName)?.delete(listener)),
      ),
  };
  return { fake, updater };
};

const setup = (options: { version?: string; disabledReason?: string | null } = {}) =>
  Effect.gen(function* () {
    const { fake, updater } = makeFakeUpdater();
    const published: UpdateState[] = [];
    const updates = yield* AppUpdates.make({
      updater,
      version: options.version ?? "0.1.0",
      disabledReason: options.disabledReason === undefined ? null : options.disabledReason,
      publish: (state) => published.push(state),
    });
    const statuses = () => published.map((state) => state.status);
    return { fake, updates, published, statuses };
  });

const failure = (operation: "check" | "download" | "install", message: string) =>
  Effect.fail(new ElectronUpdaterError({ operation, cause: new Error(message) }));

describe("defaultChannel", () => {
  it("is nightly for nightly versions and latest otherwise", () => {
    assert.strictEqual(Machine.defaultChannel("0.2.0-nightly.20261023.41"), "nightly");
    assert.strictEqual(Machine.defaultChannel("0.2.0"), "latest");
    assert.strictEqual(Machine.defaultChannel("0.2.0-beta.1"), "latest");
  });
});

describe("disabledReason", () => {
  it("disables an unpackaged dev app and an app without a feed", () => {
    assert.match(AppUpdates.disabledReason({ isPackaged: false, hasFeedConfig: true })!, /packaged app/);
    assert.match(AppUpdates.disabledReason({ isPackaged: true, hasFeedConfig: false })!, /no update feed/);
    assert.isNull(AppUpdates.disabledReason({ isPackaged: true, hasFeedConfig: true }));
  });
});

describe("AppUpdates", () => {
  it.effect("stays disabled in a dev app and never touches the updater", () =>
    Effect.gen(function* () {
      const { fake, updates, statuses } = yield* setup({ disabledReason: "Updates work only in the packaged app." });
      const state = yield* updates.getState;
      assert.strictEqual(state.status, "disabled");
      assert.isFalse(state.enabled);
      assert.strictEqual(state.message, "Updates work only in the packaged app.");
      assert.strictEqual(fake.listenerCount(), 0);

      yield* TestClock.adjust(Duration.minutes(10));
      const check = yield* updates.check;
      assert.isFalse(check.checked);
      assert.strictEqual(fake.checks, 0);
      assert.deepStrictEqual(statuses(), ["disabled"]);
    }).pipe(Effect.scoped),
  );

  it.effect("starts idle on the installed version's channel, without downloading by itself", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup({ version: "0.2.0-nightly.20261023.41" });
      const state = yield* updates.getState;
      assert.strictEqual(state.status, "idle");
      assert.strictEqual(state.channel, "nightly");
      assert.strictEqual(fake.channel, "nightly");
      assert.isTrue(fake.allowPrerelease);
      assert.isFalse(fake.autoDownload);
    }).pipe(Effect.scoped),
  );

  it.effect("checks 15 s after launch and then every 4 minutes", () =>
    Effect.gen(function* () {
      const { fake } = yield* setup();
      yield* TestClock.adjust(Duration.millis(14_999));
      assert.strictEqual(fake.checks, 0);
      yield* TestClock.adjust(Duration.millis(1));
      assert.strictEqual(fake.checks, 1);
      yield* TestClock.adjust(Duration.millis(240_000 - 1));
      assert.strictEqual(fake.checks, 1);
      yield* TestClock.adjust(Duration.millis(1));
      assert.strictEqual(fake.checks, 2);
      yield* TestClock.adjust(Duration.minutes(4));
      assert.strictEqual(fake.checks, 3);
    }).pipe(Effect.scoped),
  );

  it.effect("stops checking and listening when the scope closes", () =>
    Effect.gen(function* () {
      const { fake, updater } = makeFakeUpdater();
      yield* AppUpdates.make({ updater, version: "0.1.0", disabledReason: null, publish: () => {} }).pipe(Effect.scoped);
      yield* TestClock.adjust(Duration.minutes(10));
      assert.strictEqual(fake.checks, 0);
      assert.strictEqual(fake.listenerCount(), 0);
    }),
  );

  it.effect("goes checking, then up-to-date when the feed has nothing newer", () =>
    Effect.gen(function* () {
      const { fake, updates, statuses } = yield* setup();
      fake.onCheck = Effect.sync(() => fake.emit("update-not-available"));
      const result = yield* updates.check;
      assert.isTrue(result.checked);
      assert.strictEqual(result.state.status, "up-to-date");
      assert.isNotNull(result.state.checkedAt);
      assert.deepStrictEqual(statuses(), ["idle", "checking", "up-to-date"]);
    }).pipe(Effect.scoped),
  );

  it.effect("reports a newer version as available, and one of the other channel as up to date", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      fake.onCheck = Effect.sync(() => fake.emit("update-available", { version: "0.3.0" }));
      const available = yield* updates.check;
      assert.strictEqual(available.state.status, "available");
      assert.strictEqual(available.state.availableVersion, "0.3.0");

      fake.onCheck = Effect.sync(() => fake.emit("update-available", { version: "0.4.0-nightly.20261024.50" }));
      const otherChannel = yield* updates.check;
      assert.strictEqual(otherChannel.state.status, "up-to-date");
      assert.isNull(otherChannel.state.availableVersion);
    }).pipe(Effect.scoped),
  );

  it.effect("goes to error when a check fails, with a retry", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      fake.onCheck = failure("check", "net::ERR_INTERNET_DISCONNECTED\nstack");
      const result = yield* updates.check;
      assert.strictEqual(result.state.status, "error");
      assert.strictEqual(result.state.errorContext, "check");
      assert.isTrue(result.state.canRetry);
      assert.strictEqual(result.state.message, "Could not check the update: net::ERR_INTERNET_DISCONNECTED");
    }).pipe(Effect.scoped),
  );

  it.effect("goes to error when the updater reports one between actions", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      fake.emit("error", new Error("feed unreadable"));
      const state = yield* updates.getState;
      assert.strictEqual(state.status, "error");
      assert.strictEqual(state.message, "feed unreadable");
    }).pipe(Effect.scoped),
  );

  it.effect("keeps a found update available through a failed check or a background error", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      fake.onCheck = Effect.sync(() => fake.emit("update-available", { version: "0.3.0" }));
      yield* updates.check;
      fake.onCheck = failure("check", "net::ERR_INTERNET_DISCONNECTED");
      const failed = yield* updates.check;
      assert.strictEqual(failed.state.status, "available");
      assert.strictEqual(failed.state.availableVersion, "0.3.0");
      assert.isNull(failed.state.errorContext);

      fake.emit("error", new Error("feed unreadable"));
      const state = yield* updates.getState;
      assert.strictEqual(state.status, "available");
      assert.strictEqual(state.availableVersion, "0.3.0");
    }).pipe(Effect.scoped),
  );

  it.effect("downloads an available update with progress, then installs it", () =>
    Effect.gen(function* () {
      const { fake, updates, published } = yield* setup();
      fake.onCheck = Effect.sync(() => fake.emit("update-available", { version: "0.3.0" }));
      yield* updates.check;
      fake.onDownload = Effect.sync(() => {
        for (const percent of [3, 7, 12, 55, 100]) fake.emit("download-progress", { percent });
        fake.emit("update-downloaded", { version: "0.3.0" });
      });
      const download = yield* updates.download;
      assert.isTrue(download.accepted);
      assert.isTrue(download.completed);
      assert.strictEqual(download.state.status, "downloaded");
      assert.strictEqual(download.state.downloadedVersion, "0.3.0");
      // Progress reaches the page once per 10 % step.
      const percents = published.filter((state) => state.status === "downloading").map((state) => state.downloadPercent);
      assert.deepStrictEqual(percents, [0, 12, 55, 100]);

      const install = yield* updates.install;
      assert.isTrue(install.accepted);
      assert.strictEqual(fake.installs, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses a download with nothing available and an install with nothing downloaded", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      assert.isFalse((yield* updates.download).accepted);
      assert.isFalse((yield* updates.install).accepted);
      assert.strictEqual(fake.installs, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the update available after a failed download, and downloaded after a failed install", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      fake.onCheck = Effect.sync(() => fake.emit("update-available", { version: "0.3.0" }));
      yield* updates.check;
      fake.onDownload = failure("download", "disk full");
      const download = yield* updates.download;
      assert.strictEqual(download.state.status, "available");
      assert.strictEqual(download.state.errorContext, "download");
      assert.isTrue(download.state.canRetry);

      fake.onDownload = Effect.sync(() => fake.emit("update-downloaded", { version: "0.3.0" }));
      yield* updates.download;
      fake.onInstall = failure("install", "not signed");
      const install = yield* updates.install;
      assert.strictEqual(install.state.status, "downloaded");
      assert.strictEqual(install.state.errorContext, "install");
      // The failed install no longer holds the updater: a retry goes through.
      fake.onInstall = Effect.void;
      assert.isTrue((yield* updates.install).accepted);
    }).pipe(Effect.scoped),
  );

  it.effect("skips a scheduled check while downloading", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      fake.onCheck = Effect.sync(() => fake.emit("update-available", { version: "0.3.0" }));
      yield* updates.check;
      const release = yield* Deferred.make<void>();
      fake.onDownload = Deferred.await(release);
      const downloading = yield* updates.download.pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      assert.strictEqual((yield* updates.getState).status, "downloading");
      yield* TestClock.adjust(Duration.minutes(5));
      assert.strictEqual(fake.checks, 1);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(downloading);
    }).pipe(Effect.scoped),
  );

  it.effect("switches channel, checks again allowing a downgrade once, and refuses a switch during an action", () =>
    Effect.gen(function* () {
      const { fake, updates } = yield* setup();
      let downgradeDuringCheck = false;
      fake.onCheck = Effect.sync(() => {
        downgradeDuringCheck = fake.allowDowngrade;
        fake.emit("update-available", { version: "0.0.9-nightly.20261023.41" });
      });
      const state = yield* updates.setChannel("nightly");
      assert.strictEqual(state.channel, "nightly");
      assert.strictEqual(state.status, "available");
      assert.strictEqual(fake.channel, "nightly");
      assert.isTrue(downgradeDuringCheck);
      // Nightly keeps allowing downgrades, as T3 Code.
      assert.isTrue(fake.allowDowngrade);

      const release = yield* Deferred.make<void>();
      fake.onDownload = Deferred.await(release);
      yield* updates.download.pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      const refused = yield* updates.setChannel("latest").pipe(Effect.flip);
      assert.match(refused.message, /download is in progress/);
      yield* Deferred.succeed(release, undefined);
    }).pipe(Effect.scoped),
  );
});
