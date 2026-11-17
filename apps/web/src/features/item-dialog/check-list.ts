import type { ItemChecks } from '@lar-factory/shared';

type CheckRun = ItemChecks['runs'][number];

/** One local check: the same arguments in the same folder, with its latest run shown and earlier runs collapsed. */
interface CheckCommand {
    /** Its arguments as plain text. */
    command: string;
    /** Where it ran; null for the repository root ("."). */
    folder: string | null;
    latest: CheckRun;
    /** Earlier runs, newest first. */
    earlier: CheckRun[];
    /** Earlier runs whose failure is still open, which stay visible while the rest collapse. */
    openFailures: CheckRun[];
}

/** An argument every POSIX shell and zsh read as itself: only safe characters, and no leading `=` (zsh expands it). */
const PLAIN_ARG = /^[\w./:@%+,-][\w./:@%+,=-]*$/;

/** A command as a shell would take it: each argument plain, single-quoting any other, such as one that is empty or
 *  has spaces, glob or other shell characters, so the copied text runs the same. */
export const commandText = (command: string[]): string =>
    command.map((arg) => (PLAIN_ARG.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`)).join(' ');

/** The runs, oldest first, as one entry per check in the order each was first run. */
export function checkCommands(runs: CheckRun[]): CheckCommand[] {
    const byCheck = new Map<string, CheckRun[]>();

    for (const run of runs) {
        const key = JSON.stringify([run.command, run.folder]);

        byCheck.set(key, [run, ...(byCheck.get(key) ?? [])]);
    }

    return [...byCheck.values()].map(([latest, ...earlier]) => ({
        command: commandText(latest!.command),
        folder: latest!.folder === '.' ? null : latest!.folder,
        latest: latest!,
        earlier,
        openFailures: earlier.filter((run) => run.failureState === 'open'),
    }));
}
