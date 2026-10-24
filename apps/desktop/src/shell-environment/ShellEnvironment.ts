// The environment for the board server child. An app opened from Finder inherits a
// PATH that is often just /usr/bin:/bin, so this reads the login shell's PATH and a
// few more variables the way T3 Code does. Copied from T3 Code's
// apps/desktop/src/shell/DesktopShellEnvironment.ts and packages/shared/src/shell.ts,
// keeping macOS only, returning a new environment instead of changing process.env,
// and adding the Homebrew folders apps/server/src/tools/tools.ts adds.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see LICENSE.

import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

type Environment = Record<string, string | undefined>;

const LOGIN_SHELL_ENV_NAMES = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "__MISE_DIFF",
] as const;
/** Taken from the login shell even when the app inherited a value. */
const SHELL_PREFERRED_ENV_NAMES = [
  // mise's record of the PATH entries it added. It must travel with the shell's
  // PATH, or `mise x` can rebuild PATH behind a same-named wrapper that re-runs itself.
  "__MISE_DIFF",
] as const;
/** Taken from the login shell only when the app inherited none. */
const SHELL_FILLED_ENV_NAMES = [
  "SSH_AUTH_SOCK",
  "HOMEBREW_PREFIX",
  "HOMEBREW_CELLAR",
  "HOMEBREW_REPOSITORY",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  // CA trust set in the shell profile, without which a Node or OpenSSL build with
  // no bundled roots cannot verify TLS.
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
] as const;
const LOCALE_ENV_NAMES = ["LANG", "LC_ALL", "LC_CTYPE"] as const;
const FALLBACK_LC_CTYPE = "en_US.UTF-8";
const FALLBACK_SHELL = "/bin/zsh";
/** Last on the PATH, so tools resolve when neither the login shell nor launchctl answers. */
const HOMEBREW_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
const SHELL_ENV_NAME_PATTERN = /^[A-Z0-9_]+$/;
const LOGIN_SHELL_TIMEOUT = Duration.seconds(5);
const LAUNCHCTL_TIMEOUT = Duration.seconds(2);
const PROCESS_TERMINATE_GRACE = Duration.seconds(1);

const trimNonEmpty = (value: string | null | undefined): string | undefined => value?.trim() || undefined;

const readUserLoginShell = (): string | undefined => {
  try {
    return trimNonEmpty(NodeOS.userInfo().shell);
  } catch {
    return undefined;
  }
};

/** $SHELL, then the account's shell, then zsh, without duplicates. */
const listLoginShellCandidates = (shell: string | undefined, userShell: string | undefined) => [
  ...new Set([trimNonEmpty(shell), trimNonEmpty(userShell), FALLBACK_SHELL].filter((entry) => entry !== undefined)),
];

/** The entries of each PATH in order, trimmed, without empty entries or duplicates. */
const mergePaths = (values: ReadonlyArray<string | undefined>): string =>
  [...new Set(values.flatMap((value) => value?.split(":") ?? []).map((entry) => entry.trim()).filter(Boolean))].join(
    ":",
  );

const startMarker = (name: string) => `__T3CODE_ENV_${name}_START__`;
const endMarker = (name: string) => `__T3CODE_ENV_${name}_END__`;

/** A command for `<shell> -ilc` that prints each variable between its markers. */
const buildEnvironmentCaptureCommand = (shell: string, names: ReadonlyArray<string>): string => {
  const isNushell = NodePath.basename(shell).toLowerCase().startsWith("nu");
  return names
    .map((name) => {
      if (!SHELL_ENV_NAME_PATTERN.test(name)) {
        throw new Error(`Unsupported environment variable name: ${name}`);
      }
      if (isNushell) {
        // Without a configured conversion, Nu expands home paths only in a list PATH.
        const defaultValue =
          name === "PATH"
            ? "if ($env.PATH? | describe | str starts-with 'list') { " +
              "$env.PATH | each {|p| if ($p | str starts-with '~') { " +
              "$p | path expand --no-symlink } else { $p } } | str join (char esep) " +
              "} else { $env.PATH? | default '' }"
            : `$env.${name}? | default ''`;
        const value =
          `if $env.${name}? == null { '' } else if ` +
          `$env.ENV_CONVERSIONS?.${name}?.to_string? != null { ` +
          `$env.${name} | do $env.ENV_CONVERSIONS.${name}.to_string $env.${name} ` +
          `} else { ${defaultValue} }`;
        return [`print '${startMarker(name)}'`, `print (${value})`, `print '${endMarker(name)}'`].join("; ");
      }
      return [
        `printf '%s\\n' '${startMarker(name)}'`,
        `printenv ${name} || true`,
        `printf '%s\\n' '${endMarker(name)}'`,
      ].join("; ");
    })
    .join("; ");
};

const extractEnvironment = (output: string, names: ReadonlyArray<string>): Record<string, string> => {
  const environment: Record<string, string> = {};
  for (const name of names) {
    const start = output.indexOf(startMarker(name));
    if (start === -1) continue;
    const valueStart = start + startMarker(name).length;
    const end = output.indexOf(endMarker(name), valueStart);
    if (end === -1) continue;
    const value = output.slice(valueStart, end).replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    if (value.length > 0) environment[name] = value;
  }
  return environment;
};

/** What the command printed when it exits with 0 in time; otherwise logs why and returns "". */
const runCommandOutput = (input: {
  readonly probe: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly timeout: Duration.Duration;
}): Effect.Effect<string, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(input.command, input.args, {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        killSignal: "SIGTERM",
        forceKillAfter: PROCESS_TERMINATE_GRACE,
      }),
    );
    return yield* Effect.all([Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode], {
      concurrency: 2,
    });
  }).pipe(
    Effect.scoped,
    Effect.flatMap(([stdout, exitCode]) =>
      exitCode === 0 ? Effect.succeed(stdout) : Effect.fail(`exited with code ${exitCode}`),
    ),
    Effect.timeoutOrElse({
      duration: input.timeout,
      orElse: () => Effect.fail(`timed out after ${Duration.format(input.timeout)}`),
    }),
    Effect.catch((reason) =>
      Effect.logWarning(`shell environment ${input.probe} probe (${input.command}) failed: ${String(reason)}`).pipe(
        Effect.as(""),
      ),
    ),
  );

const readLoginShellEnvironment = (shell: string) =>
  runCommandOutput({
    probe: "login-shell",
    command: shell,
    args: ["-ilc", buildEnvironmentCaptureCommand(shell, LOGIN_SHELL_ENV_NAMES)],
    timeout: LOGIN_SHELL_TIMEOUT,
  }).pipe(Effect.map((output) => extractEnvironment(output, LOGIN_SHELL_ENV_NAMES)));

const readLaunchctlPath = runCommandOutput({
  probe: "launchctl-path",
  command: "/bin/launchctl",
  args: ["getenv", "PATH"],
  timeout: LAUNCHCTL_TIMEOUT,
}).pipe(Effect.map(trimNonEmpty));

/**
 * `env` with the login shell's PATH first, then the inherited PATH, then the Homebrew
 * folders. The shells tried are $SHELL, the account's and zsh, until one prints a
 * PATH; then `launchctl getenv PATH`. It also fills in SSH_AUTH_SOCK, Homebrew, CA
 * trust and locale variables the app didn't inherit. It never fails: a probe that
 * fails or times out is logged and skipped.
 */
export const childEnvironment = Effect.fn("ShellEnvironment.childEnvironment")(function* (
  env: Readonly<Environment>,
  userShell: string | undefined = readUserLoginShell(),
): Effect.fn.Return<Environment, never, ChildProcessSpawner.ChildProcessSpawner> {
  const shellEnvironment: Record<string, string> = {};
  for (const shell of listLoginShellCandidates(env.SHELL, userShell)) {
    Object.assign(shellEnvironment, yield* readLoginShellEnvironment(shell));
    if (shellEnvironment.PATH) break;
  }
  const loginPath = trimNonEmpty(shellEnvironment.PATH) ?? (yield* readLaunchctlPath);

  const result: Environment = { ...env, PATH: mergePaths([loginPath, env.PATH, ...HOMEBREW_DIRS]) };
  for (const name of SHELL_PREFERRED_ENV_NAMES) {
    if (shellEnvironment[name]) result[name] = shellEnvironment[name];
  }
  for (const name of SHELL_FILLED_ENV_NAMES) {
    if (!result[name] && shellEnvironment[name]) result[name] = shellEnvironment[name];
  }

  // Locale variables form one precedence group: LC_ALL can override an inherited
  // LANG or LC_CTYPE, so only fill the group when the app inherited none of them.
  if (LOCALE_ENV_NAMES.every((name) => !trimNonEmpty(result[name]))) {
    for (const name of LOCALE_ENV_NAMES) {
      const value = trimNonEmpty(shellEnvironment[name]);
      if (value) result[name] = value;
    }
    // A Finder launch inherits no locale, so children land in the C locale. Set only
    // LC_CTYPE to a UTF-8 locale every supported macOS has, keeping C collation.
    if (LOCALE_ENV_NAMES.every((name) => !trimNonEmpty(result[name]))) {
      result.LC_CTYPE = FALLBACK_LC_CTYPE;
    }
  }
  return result;
});
