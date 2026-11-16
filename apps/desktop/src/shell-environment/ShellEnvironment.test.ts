// Copied from T3 Code's apps/desktop/src/shell/DesktopShellEnvironment.test.ts, keeping
// the macOS cases.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Logger from 'effect/Logger';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import * as Sink from 'effect/Sink';
import * as Stream from 'effect/Stream';

import * as ShellEnvironment from './ShellEnvironment.ts';

const textEncoder = new TextEncoder();

function envOutput(values: Readonly<Record<string, string>>): string {
    return Object.entries(values)
        .flatMap(([name, value]) => [`__T3CODE_ENV_${name}_START__`, value, `__T3CODE_ENV_${name}_END__`])
        .join('\n');
}

function makeProcess(output: string, exitCode = 0): ChildProcessSpawner.ChildProcessHandle {
    const stdout = output.length === 0 ? Stream.empty : Stream.make(textEncoder.encode(output));

    return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(123),
        stdout,
        stderr: Stream.empty,
        all: stdout,
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
    });
}

/** Reads the child environment with a spawner that answers each command through `handler`. */
function readChildEnvironment(input: {
    readonly env: NodeJS.ProcessEnv;
    readonly userShell?: string;
    readonly handler: (command: string) => string | { output: string; exitCode: number };
}) {
    const commands: string[] = [];
    const spawner = ChildProcessSpawner.make((command) => {
        const name = command._tag === 'StandardCommand' ? command.command : '';

        commands.push(name);

        const result = input.handler(name);

        return Effect.succeed(
            typeof result === 'string' ? makeProcess(result) : makeProcess(result.output, result.exitCode),
        );
    });

    return ShellEnvironment.childEnvironment(input.env, input.userShell).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provide(Logger.layer([])),
        Effect.map((env) => ({ env, commands })),
    );
}

describe('childEnvironment', () => {
    it.effect('puts the login shell PATH first, then the inherited one, then the Homebrew folders', () =>
        Effect.gen(function* () {
            const { env, commands } = yield* readChildEnvironment({
                env: { SHELL: '/bin/zsh', PATH: '/usr/bin:/bin' },
                handler: () => envOutput({ PATH: '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin' }),
            });

            assert.deepStrictEqual(commands, ['/bin/zsh']);
            assert.strictEqual(env.PATH, '/Users/me/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin');
        }),
    );

    it.effect('adds a missing SSH_AUTH_SOCK, Homebrew and CA trust variables and keeps inherited ones', () =>
        Effect.gen(function* () {
            const { env } = yield* readChildEnvironment({
                env: { SHELL: '/bin/zsh', PATH: '/usr/bin', SSL_CERT_DIR: '/etc/ssl/certs' },
                handler: () =>
                    envOutput({
                        PATH: '/opt/homebrew/bin:/usr/bin',
                        SSH_AUTH_SOCK: '/tmp/secretive.sock',
                        HOMEBREW_PREFIX: '/opt/homebrew',
                        SSL_CERT_FILE: '/opt/homebrew/etc/cacert.pem',
                        SSL_CERT_DIR: '/opt/homebrew/etc/certs',
                        NODE_EXTRA_CA_CERTS: '/Users/me/corp-root.pem',
                    }),
            });

            assert.strictEqual(env.SSH_AUTH_SOCK, '/tmp/secretive.sock');
            assert.strictEqual(env.HOMEBREW_PREFIX, '/opt/homebrew');
            assert.strictEqual(env.SSL_CERT_FILE, '/opt/homebrew/etc/cacert.pem');
            assert.strictEqual(env.SSL_CERT_DIR, '/etc/ssl/certs');
            assert.strictEqual(env.NODE_EXTRA_CA_CERTS, '/Users/me/corp-root.pem');
        }),
    );
});
