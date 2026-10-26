// Starts the board server as a child of the main process, modelled on T3 Code's
// apps/desktop/src/backend/DesktopBackendConfiguration.ts and DesktopBackendManager.ts.
// T3 Code hands its server a bootstrap fd; the board reports its port over an IPC
// channel instead (apps/server/src/port/port.ts), which Effect's ChildProcess has no option
// for, so this spawns with node:child_process.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import type * as Scope from "effect/Scope";
import { HttpClient, HttpClientRequest } from "effect/http";

const DEFAULT_PORT_TIMEOUT = Duration.seconds(30);
const READINESS_TIMEOUT = Duration.minutes(1);
const READINESS_INTERVAL = Duration.millis(100);
const READINESS_REQUEST_TIMEOUT = Duration.seconds(1);
const TERMINATE_GRACE = Duration.seconds(5);
/** How long a drain may wait for running writes; a Start runs T3 Code's CLI, which takes seconds. */
const DRAIN_TIMEOUT = Duration.minutes(2);
const HOST = "127.0.0.1";

/** How to run the board server: the program, its arguments, directory and full environment. */
export interface StartConfig {
  readonly executablePath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** A running board server, the address of its page and how it ended. */
export interface RunningBoard {
  readonly pid: number;
  readonly url: URL;
  /** Succeeds with the exit code or signal once the server exits. */
  readonly exited: Effect.Effect<string>;
}

export class BoardServerError extends Data.TaggedError("BoardServerError")<{
  readonly message: string;
}> {}

/** Where the board server sits beside the app: in the checkout, or in the packaged app's Resources. */
export interface BoardLocation {
  /** The server's working directory. */
  readonly serverDir: string;
  /** The file Node runs. */
  readonly serverFile: string;
  readonly configFile: string;
}

/**
 * Finds the board server and `config.json` from `appPath`, Electron's app path. In
 * development that is `apps/desktop` in the checkout: the server runs from
 * `apps/server/src/server.ts`, with `config.json` at the repo root. Packaged, it is
 * `Resources/app.asar`, which has no node_modules, so the server runs as one bundled
 * file in `Resources/server/dist`, which finds the page's build in `Resources/web/dist`;
 * `config.json` sits in `Resources/`.
 */
export const locate = (appPath: string, isPackaged: boolean): BoardLocation => {
  const serverDir = NodePath.resolve(appPath, "../server");
  return isPackaged
    ? {
        serverDir,
        serverFile: NodePath.join(serverDir, "dist/server.mjs"),
        configFile: NodePath.resolve(appPath, "../config.json"),
      }
    : {
        serverDir,
        serverFile: NodePath.join(serverDir, "src/server.ts"),
        configFile: NodePath.resolve(appPath, "../../config.json"),
      };
};

/**
 * Runs `serverFile` with `executablePath` in Node mode. In the app that is the
 * Electron binary, whose Node strips the types when the server runs as source.
 * The server reads `configFile` and refuses guarded writes that don't carry `secret`.
 */
export const makeStartConfig = (input: BoardLocation & {
  readonly executablePath: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly secret: string;
}): StartConfig => ({
  executablePath: input.executablePath,
  args: ["--disable-warning=ExperimentalWarning", input.serverFile],
  cwd: input.serverDir,
  env: { ...input.env, ELECTRON_RUN_AS_NODE: "1", BOARD_CONFIG_FILE: input.configFile, BOARD_APP_SECRET: input.secret },
});

/**
 * Starts the server, reads the port it reports and waits for `/healthz` to answer.
 * Closing the scope stops the server: SIGTERM, then SIGKILL after a grace period.
 */
export const start = Effect.fn("BoardServer.start")(function* (
  config: StartConfig,
  options?: { readonly portTimeout?: Duration.Input },
): Effect.fn.Return<RunningBoard, BoardServerError, Scope.Scope | HttpClient.HttpClient> {
  const child = yield* Effect.acquireRelease(spawn(config), stop);
  const port = yield* reportedPort(child, options?.portTimeout ?? DEFAULT_PORT_TIMEOUT);
  const url = new URL(`http://${HOST}:${port}/`);
  yield* waitForHealthz(url);
  return { pid: child.pid!, url, exited: exitReason(child) };
});

/**
 * Asks the server at `url` to refuse new writes and succeeds once its running ones
 * finish, so it can stop without cutting one off. Only the launch `secret` is let through.
 */
export const drain = Effect.fn("BoardServer.drain")(function* (url: URL, secret: string) {
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  // The server takes writes only from its own origin.
  const request = HttpClientRequest.post(new URL("/api/drain", url)).pipe(
    HttpClientRequest.setHeaders({ Origin: url.origin, "X-Board-Secret": secret }),
  );
  yield* client.execute(request).pipe(
    Effect.flatMap((response) => response.text),
    Effect.timeout(DRAIN_TIMEOUT),
    Effect.mapError((cause) => new BoardServerError({ message: `could not drain the board's writes: ${String(cause)}` })),
  );
});

const spawn = (config: StartConfig) =>
  Effect.try({
    try: () =>
      NodeChildProcess.spawn(config.executablePath, config.args, {
        cwd: config.cwd,
        env: config.env,
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      }),
    catch: (cause) => new BoardServerError({ message: `could not start the board server: ${String(cause)}` }),
  });

const exited = (child: NodeChildProcess.ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null;

const describeExit = (code: number | null, signal: NodeJS.Signals | null) =>
  signal ? `on ${signal}` : `with code ${code}`;

const exitReason = (child: NodeChildProcess.ChildProcess) =>
  Effect.callback<string>((resume) => {
    if (exited(child)) return resume(Effect.succeed(describeExit(child.exitCode, child.signalCode)));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      resume(Effect.succeed(describeExit(code, signal)));
    child.once("exit", onExit);
    return Effect.sync(() => child.off("exit", onExit));
  });

const stop = (child: NodeChildProcess.ChildProcess) =>
  Effect.callback<void>((resume) => {
    if (exited(child)) return resume(Effect.void);
    const forceKill = setTimeout(() => child.kill("SIGKILL"), Duration.toMillis(TERMINATE_GRACE));
    child.once("exit", () => {
      clearTimeout(forceKill);
      resume(Effect.void);
    });
    child.kill("SIGTERM");
  });

const reportedPort = (child: NodeChildProcess.ChildProcess, timeout: Duration.Input) =>
  Effect.callback<number, BoardServerError>((resume) => {
    const onMessage = (message: unknown) => {
      if (isListening(message)) resume(Effect.succeed(message.port));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      resume(Effect.fail(new BoardServerError({
        message: `the board server exited ${describeExit(code, signal)} before it reported a port`,
      })));
    child.on("message", onMessage);
    child.once("exit", onExit);
    return Effect.sync(() => {
      child.off("message", onMessage);
      child.off("exit", onExit);
    });
  }).pipe(
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () =>
        Effect.fail(new BoardServerError({
          message: `the board server reported no port within ${Duration.format(Duration.fromInputUnsafe(timeout))}`,
        })),
    }),
  );

/** The message apps/server/src/port/port.ts sends once the server listens. */
const isListening = (message: unknown): message is { type: "listening"; port: number } =>
  typeof message === "object" && message !== null &&
  (message as { type?: unknown }).type === "listening" &&
  Number.isInteger((message as { port?: unknown }).port);

const waitForHealthz = Effect.fn("BoardServer.waitForHealthz")(function* (url: URL) {
  // Read every body, a 503's too, so undici frees the connection for the next try.
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.tap((response) => response.text.pipe(Effect.ignore)),
    HttpClient.filterStatusOk,
  );
  yield* client.execute(HttpClientRequest.get(new URL("/healthz", url))).pipe(
    Effect.timeout(READINESS_REQUEST_TIMEOUT),
    Effect.retry(Schedule.spaced(READINESS_INTERVAL)),
    Effect.mapError((cause) => new BoardServerError({ message: `${url.href}healthz failed: ${String(cause)}` })),
    Effect.timeoutOrElse({
      duration: READINESS_TIMEOUT,
      orElse: () =>
        Effect.fail(new BoardServerError({
          message: `${url.href}healthz did not answer within ${Duration.format(READINESS_TIMEOUT)}`,
        })),
    }),
  );
});
