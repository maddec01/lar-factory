// Keeps the board server running: starts it, and starts it again with backoff when
// it exits or fails to start, as T3 Code's apps/desktop/src/backend/DesktopBackendManager.ts
// does (500 ms doubling to 10 s, reset once the server is ready).
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import type * as Scope from "effect/Scope";

import type { BoardServerError, RunningBoard } from "./BoardServer.ts";

export interface RestartDelays {
  readonly initialDelay: Duration.Input;
  readonly maxDelay: Duration.Input;
}

const DEFAULT_DELAYS: RestartDelays = { initialDelay: Duration.millis(500), maxDelay: Duration.seconds(10) };

/** The wait before restart number `attempt + 1`: `initialDelay` doubled per attempt, capped at `maxDelay`. */
const restartDelay = (attempt: number, delays: RestartDelays = DEFAULT_DELAYS): Duration.Duration =>
  Duration.min(
    Duration.times(Duration.fromInputUnsafe(delays.initialDelay), 2 ** attempt),
    Duration.fromInputUnsafe(delays.maxDelay),
  );

export interface SupervisorEvents {
  /** Called with each ready server's page. */
  readonly onReady: (url: URL) => Effect.Effect<void>;
  /** Called with why the server stopped or didn't start, before the wait to restart it. */
  readonly onRestart?: (reason: string) => Effect.Effect<void>;
}

/**
 * Runs `start` and calls `onReady` with each server's page, and `onRestart` with
 * why each one stopped or failed, until interrupted. Interrupting it stops the
 * running server, or cancels a pending restart so no new server starts.
 */
export const supervise = <R>(
  start: Effect.Effect<RunningBoard, BoardServerError, Scope.Scope | R>,
  { onReady, onRestart = () => Effect.void }: SupervisorEvents,
  delays: RestartDelays = DEFAULT_DELAYS,
): Effect.Effect<never, never, Exclude<R, Scope.Scope>> =>
  Effect.gen(function* () {
    let attempt = 0;
    while (true) {
      const reason = yield* Effect.gen(function* () {
        const board = yield* start;
        attempt = 0;
        yield* onReady(board.url);
        return `the board server exited ${yield* board.exited}`;
      }).pipe(
        Effect.scoped,
        Effect.catch((error) => Effect.succeed(error.message)),
      );
      const delay = restartDelay(attempt, delays);
      attempt += 1;
      yield* Effect.logError(`${reason}; restarting in ${Duration.format(delay)}`);
      yield* onRestart(reason);
      yield* Effect.sleep(delay);
    }
  });

/** Starts and stops a supervised board server; the app stops it before installing an update. */
export interface SupervisorControl {
  /** Runs the supervisor unless it runs already. */
  readonly start: Effect.Effect<void>;
  /** Stops the running server, or cancels a pending restart, and waits until it has exited. */
  readonly stop: Effect.Effect<void>;
}

/** Controls `run`, a `supervise` call, until the scope closes, which stops it as well. Nothing runs until `start`. */
export const makeControl = <R>(
  run: Effect.Effect<never, never, R>,
): Effect.Effect<SupervisorControl, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const handle = yield* FiberHandle.make<never, never>();
    const runFork = yield* FiberHandle.runtime(handle)<R>();
    return {
      start: Effect.sync(() => void runFork(run, { onlyIfMissing: true })),
      stop: FiberHandle.clear(handle),
    };
  });
