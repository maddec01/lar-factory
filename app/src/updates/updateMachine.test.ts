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
const downloadFailed = Machine.reduceOnDownloadFailure(Machine.reduceOnDownloadStart(available), "net::ERR_TIMED_OUT");

describe("a check with an update already found", () => {
  it("keeps the update's notes", () => {
    const checking = Machine.reduceOnCheckStart(available, at);
    assert.strictEqual(checking.status, "checking");
    assert.deepStrictEqual(checking.releaseNotes, notes);
    assert.strictEqual(checking.omittedReleaseCount, 2);
  });

  it("keeps a failed download's error through the check, until a new download starts", () => {
    const checking = Machine.reduceOnCheckStart(downloadFailed, at);
    assert.strictEqual(checking.errorContext, "download");
    assert.strictEqual(checking.message, "net::ERR_TIMED_OUT");
    assert.isTrue(checking.canRetry);

    const foundAgain = Machine.reduceOnUpdateAvailable(checking, "0.3.0", at, notes);
    assert.strictEqual(foundAgain.status, "available");
    assert.strictEqual(foundAgain.errorContext, "download");
    assert.strictEqual(foundAgain.message, "net::ERR_TIMED_OUT");

    const failedCheck = Machine.reduceOnCheckFailure(checking, "offline", at);
    assert.strictEqual(failedCheck.status, "available");
    assert.strictEqual(failedCheck.message, "net::ERR_TIMED_OUT");

    const newer = Machine.reduceOnUpdateAvailable(checking, "0.4.0", at, notes);
    assert.isNull(newer.errorContext);
    assert.isNull(newer.message);

    const retried = Machine.reduceOnDownloadStart(foundAgain);
    assert.isNull(retried.errorContext);
    assert.isNull(retried.message);
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

describe("an install", () => {
  it("clears a failed install's error as a retry starts", () => {
    const downloaded = Machine.reduceOnDownloadComplete(available, "0.3.0");
    const started = Machine.reduceOnInstallStart(Machine.reduceOnInstallFailure(downloaded, "quit refused"));
    assert.strictEqual(started.status, "downloaded");
    assert.isNull(started.errorContext);
    assert.isNull(started.message);
  });
});
