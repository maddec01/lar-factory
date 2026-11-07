// Runs a wrapped command in its own process group. A termination signal to lar-work reaches that group and no other
// process; a group still running after a short grace period is killed. lar-work never signals a process it didn't start.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { constants } from 'node:os';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const GRACE_MS = 3000;

interface GroupOutcome {
    code: number;
    signal: NodeJS.Signals | null;
}
export interface Termination {
    /** The first termination signal lar-work received, if any. */
    readonly signal: NodeJS.Signals | undefined;
    /** Settles when the first termination signal arrives. */
    readonly signalled: Promise<NodeJS.Signals>;
    /**
     * Runs `command`'s words directly, without a shell, and settles with its exit status: 128 plus the signal number when
     * a signal killed it, 127 when it isn't found and 126 when it can't start otherwise. After a termination signal it
     * starts nothing.
     */
    run(
        command: string[],
        options: { stdio: StdioOptions; env?: NodeJS.ProcessEnv; started?: (child: ChildProcess) => void },
    ): Promise<GroupOutcome>;
    /** Stops listening for termination signals. */
    dispose(): void;
}

export const signalStatus = (signal: NodeJS.Signals): number => 128 + constants.signals[signal];

/** Listens for termination signals until disposed, forwarding them to the group `run` started. */
export function trapTermination(): Termination {
    let first: NodeJS.Signals | undefined;
    let notify: (signal: NodeJS.Signals) => void = () => {};
    const signalled = new Promise<NodeJS.Signals>((resolve) => {
        notify = resolve;
    });
    let forward: ((signal: NodeJS.Signals) => void) | undefined;
    const handlers = SIGNALS.map((signal) => {
        const handler = () => {
            first ??= signal;
            notify(signal);
            forward?.(signal);
        };

        process.on(signal, handler);

        return handler;
    });

    return {
        get signal() {
            return first;
        },
        signalled,
        async run(command, { stdio, env, started }) {
            if (first) return { code: signalStatus(first), signal: null };

            const child = spawn(command[0]!, command.slice(1), { stdio, env, detached: process.platform !== 'win32' });
            const running = () => child.pid !== undefined && child.exitCode === null && child.signalCode === null;
            // The group outlives its leader while any member runs; no new process can take its ID until the group is gone.
            const groupRunning = () => {
                if (process.platform === 'win32' || child.pid === undefined) return running();

                try {
                    process.kill(-child.pid, 0);

                    return true;
                } catch (error) {
                    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
                }
            };
            const signalGroup = (signal: NodeJS.Signals) => {
                if (!groupRunning()) return;

                try {
                    if (process.platform !== 'win32') process.kill(-child.pid!, signal);
                    else child.kill(signal);
                } catch {
                    /* The group already exited. */
                }
            };
            // Settles once the group has ended, or been killed after the grace period, following a forwarded signal.
            let ended: Promise<void> | undefined;

            forward = (signal) => {
                signalGroup(signal);
                ended ??= (async () => {
                    const deadline = Date.now() + GRACE_MS;

                    while (groupRunning() && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));

                    signalGroup('SIGKILL');
                })();
            };
            started?.(child);

            const outcome = await new Promise<GroupOutcome>((resolve) => {
                child.on('error', (error) => {
                    if (child.pid !== undefined) return;

                    process.stderr.write(`lar-work: can't start ${command[0]}: ${error.message}\n`);
                    resolve({ code: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 127 : 126, signal: null });
                });
                child.on('close', (code, signal) =>
                    resolve({ code: code ?? (signal ? signalStatus(signal) : 127), signal }),
                );
            });

            forward = undefined;
            await ended;

            return outcome;
        },
        dispose() {
            SIGNALS.forEach((signal, i) => process.removeListener(signal, handlers[i]!));
        },
    };
}
