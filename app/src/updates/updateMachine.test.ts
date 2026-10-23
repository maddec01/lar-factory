import { assert, describe, it } from "@effect/vitest";

import * as Machine from "./updateMachine.ts";

const at = "2026-10-23T09:00:00Z";
const notes = [{ version: "0.3.0", items: ["feat(board): keep the button"], totalItems: 1 }];
const available = Machine.reduceOnUpdateAvailable(
  Machine.createBaseUpdateState("0.2.0", "latest", null),
  "0.3.0",
  at,
  notes,
  2,
);
const downloaded = Machine.reduceOnDownloadComplete(available, "0.3.0");
const downloadFailed = Machine.reduceOnDownloadFailure(Machine.reduceOnDownloadStart(available), "net::ERR_TIMED_OUT");

describe("a check with an update found but not downloaded", () => {
  it("drops the update's notes, as T3 Code does", () => {
    const checking = Machine.reduceOnCheckStart(available, at);
    assert.strictEqual(checking.status, "checking");
    assert.deepStrictEqual(checking.releaseNotes, []);
    assert.strictEqual(checking.omittedReleaseCount, 0);
  });

  it("goes to error when it fails, as T3 Code does", () => {
    const failed = Machine.reduceOnCheckFailure(Machine.reduceOnCheckStart(available, at), "offline", at);
    assert.strictEqual(failed.status, "error");
    assert.strictEqual(failed.errorContext, "check");
    assert.strictEqual(failed.message, "offline");
    assert.isTrue(failed.canRetry);
  });

  it("clears a failed download's error, as T3 Code does", () => {
    const checking = Machine.reduceOnCheckStart(downloadFailed, at);
    assert.isNull(checking.errorContext);
    assert.isNull(checking.message);
    assert.isFalse(checking.canRetry);

    const foundAgain = Machine.reduceOnUpdateAvailable(downloadFailed, "0.3.0", at, notes);
    assert.strictEqual(foundAgain.status, "available");
    assert.isNull(foundAgain.errorContext);
    assert.isNull(foundAgain.message);
    assert.isFalse(foundAgain.canRetry);
  });
});

describe("a check with an update downloaded", () => {
  it("keeps the notes, and stays downloaded when it fails", () => {
    const checking = Machine.reduceOnCheckStart(downloaded, at);
    assert.deepStrictEqual(checking.releaseNotes, notes);
    assert.strictEqual(checking.downloadPercent, 100);

    const failed = Machine.reduceOnCheckFailure(checking, "offline", at);
    assert.strictEqual(failed.status, "downloaded");
    assert.isNull(failed.errorContext);
    assert.isTrue(failed.canRetry);
  });
});

describe("a check with nothing found", () => {
  it("clears the notes and the last error", () => {
    const failed = Machine.reduceOnCheckFailure(Machine.createBaseUpdateState("0.2.0", "latest", null), "offline", at);
    const checking = Machine.reduceOnCheckStart(failed, at);
    assert.deepStrictEqual(checking.releaseNotes, []);
    assert.isNull(checking.errorContext);
    assert.isNull(checking.message);
  });
});

describe("a background error", () => {
  it("keeps an available update, with a failed download's error", () => {
    const state = Machine.reduceOnBackgroundError(downloadFailed, "feed unreadable", at);
    assert.strictEqual(state.status, "available");
    assert.strictEqual(state.errorContext, "download");
    assert.strictEqual(state.message, "net::ERR_TIMED_OUT");
    assert.isTrue(state.canRetry);
  });

  it("keeps a downloaded update", () => {
    const state = Machine.reduceOnBackgroundError(downloaded, "feed unreadable", at);
    assert.strictEqual(state.status, "downloaded");
    assert.isNull(state.message);
  });

  it("goes to error without a found update", () => {
    const idle = Machine.createBaseUpdateState("0.2.0", "latest", null);
    const state = Machine.reduceOnBackgroundError(idle, "feed unreadable", at);
    assert.strictEqual(state.status, "error");
    assert.strictEqual(state.message, "feed unreadable");
    assert.isFalse(state.canRetry);
  });
});

describe("an install", () => {
  it("clears a failed install's error as a retry starts", () => {
    const started = Machine.reduceOnInstallStart(Machine.reduceOnInstallFailure(downloaded, "quit refused"));
    assert.strictEqual(started.status, "downloaded");
    assert.isNull(started.errorContext);
    assert.isNull(started.message);
  });
});
