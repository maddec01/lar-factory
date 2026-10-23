// The update state's transitions, copied from T3 Code's apps/desktop/src/updates/updateMachine.ts
// and updateChannels.ts, without the host and app architectures and the install record.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import type { UpdateChannel, UpdateReleaseNote, UpdateState } from "../../../board/src/app/board-app.ts";

const NIGHTLY_VERSION_PATTERN = /^[^-+]+-nightly\.\d{8}\.\d+$/;

/** The installed version's channel: `nightly` for `x.y.z-nightly.YYYYMMDD.N`, else `latest`. */
export const defaultChannel = (version: string): UpdateChannel =>
  NIGHTLY_VERSION_PATTERN.test(version) ? "nightly" : "latest";

export function createInitialUpdateState(currentVersion: string, channel: UpdateChannel): UpdateState {
  return {
    enabled: false,
    status: "disabled",
    channel,
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

/** The state before any check: `idle`, or `disabled` with the reason as its message. */
export function createBaseUpdateState(
  currentVersion: string,
  channel: UpdateChannel,
  disabledReason: string | null,
): UpdateState {
  const enabled = disabledReason === null;
  return {
    ...createInitialUpdateState(currentVersion, channel),
    enabled,
    status: enabled ? "idle" : "disabled",
    message: disabledReason,
  };
}

/**
 * A failed download's error, kept on an update still available until a new download starts, or
 * the cleared error otherwise.
 */
const keptDownloadError = (state: UpdateState): Pick<UpdateState, "message" | "errorContext" | "canRetry"> =>
  state.errorContext === "download" && state.availableVersion !== null
    ? { message: state.message, errorContext: "download", canRetry: true }
    : { message: null, errorContext: null, canRetry: false };

export function reduceOnCheckStart(state: UpdateState, checkedAt: string): UpdateState {
  const hasDownloadedUpdate = state.downloadedVersion !== null;
  // Unlike T3 Code, an update found but not yet downloaded keeps its notes through a check too, as its button stays.
  const hasFoundUpdate = hasDownloadedUpdate || state.availableVersion !== null;
  return {
    ...state,
    status: "checking",
    checkedAt,
    releaseNotes: hasFoundUpdate ? state.releaseNotes : [],
    omittedReleaseCount: hasFoundUpdate ? state.omittedReleaseCount : 0,
    downloadPercent: hasDownloadedUpdate ? 100 : null,
    ...keptDownloadError(state),
  };
}

/** The state that keeps a found update showing through a failed check or a background error, or null without one. */
function keepFoundUpdate(state: UpdateState, checkedAt: string): UpdateState | null {
  if (state.downloadedVersion !== null) {
    return {
      ...state,
      status: "downloaded",
      message: null,
      checkedAt,
      downloadPercent: 100,
      errorContext: null,
      canRetry: true,
    };
  }
  // Unlike T3 Code, an update found but not yet downloaded stays available too, so its button stays.
  if (state.availableVersion !== null) {
    return {
      ...state,
      status: "available",
      checkedAt,
      downloadPercent: null,
      ...keptDownloadError(state),
      canRetry: true,
    };
  }
  return null;
}

export function reduceOnCheckFailure(state: UpdateState, message: string, checkedAt: string): UpdateState {
  const kept = keepFoundUpdate(state, checkedAt);
  if (kept) return kept;

  return {
    ...state,
    status: "error",
    message,
    checkedAt,
    downloadPercent: null,
    errorContext: "check",
    canRetry: true,
  };
}

export function reduceOnUpdateAvailable(
  state: UpdateState,
  version: string,
  checkedAt: string,
  releaseNotes: readonly UpdateReleaseNote[] = [],
  omittedReleaseCount = 0,
): UpdateState {
  const isDownloadedVersion = state.downloadedVersion === version;
  const preserveReleaseNotes = isDownloadedVersion && releaseNotes.length === 0;
  // The same version found again keeps a failed download's error until a new download starts.
  const sameAvailable = !isDownloadedVersion && state.availableVersion === version;
  const error = sameAvailable ? keptDownloadError(state) : { message: null, errorContext: null, canRetry: false };
  return {
    ...state,
    status: isDownloadedVersion ? "downloaded" : "available",
    availableVersion: version,
    downloadedVersion: isDownloadedVersion ? version : null,
    releaseNotes: preserveReleaseNotes ? state.releaseNotes : releaseNotes,
    omittedReleaseCount: preserveReleaseNotes ? state.omittedReleaseCount : omittedReleaseCount,
    downloadPercent: isDownloadedVersion ? 100 : null,
    checkedAt,
    ...error,
    canRetry: isDownloadedVersion || error.canRetry,
  };
}

export function reduceOnNoUpdate(state: UpdateState, checkedAt: string): UpdateState {
  if (state.downloadedVersion !== null) {
    return {
      ...state,
      status: "downloaded",
      availableVersion: state.downloadedVersion,
      downloadPercent: 100,
      checkedAt,
      message: null,
      errorContext: null,
      canRetry: true,
    };
  }

  return {
    ...state,
    status: "up-to-date",
    availableVersion: null,
    downloadedVersion: null,
    releaseNotes: [],
    omittedReleaseCount: 0,
    downloadPercent: null,
    checkedAt,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceOnDownloadStart(state: UpdateState): UpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: 0,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceOnDownloadFailure(state: UpdateState, message: string): UpdateState {
  return {
    ...state,
    status: state.availableVersion ? "available" : "error",
    message,
    downloadPercent: null,
    errorContext: "download",
    canRetry: state.availableVersion !== null,
  };
}

export function reduceOnDownloadProgress(state: UpdateState, percent: number): UpdateState {
  return {
    ...state,
    status: "downloading",
    downloadPercent: percent,
    message: null,
    errorContext: null,
    canRetry: false,
  };
}

export function reduceOnDownloadComplete(state: UpdateState, version: string): UpdateState {
  return {
    ...state,
    status: "downloaded",
    availableVersion: version,
    downloadedVersion: version,
    downloadPercent: 100,
    message: null,
    errorContext: null,
    canRetry: true,
  };
}

/** Clears a failed install's error as a retry starts, so the page doesn't read the retry as failed. */
export function reduceOnInstallStart(state: UpdateState): UpdateState {
  return { ...state, message: null, errorContext: null };
}

export function reduceOnInstallFailure(state: UpdateState, message: string): UpdateState {
  return {
    ...state,
    status: "downloaded",
    message,
    errorContext: "install",
    canRetry: true,
  };
}

/** An error the updater reports outside a check, download or install. */
export function reduceOnBackgroundError(state: UpdateState, message: string, checkedAt: string): UpdateState {
  return (
    keepFoundUpdate(state, checkedAt) ?? {
      ...state,
      status: "error",
      message,
      checkedAt,
      downloadPercent: null,
      canRetry: false,
    }
  );
}

/** Whether a download at `nextPercent` is worth sending to the page: each 10 % step and the end. */
export function shouldBroadcastDownloadProgress(state: UpdateState, nextPercent: number): boolean {
  if (state.status !== "downloading" || state.downloadPercent === null) return true;
  return Math.floor(nextPercent / 10) !== Math.floor(state.downloadPercent / 10) || nextPercent === 100;
}
