// Keeps one release folder per app release in the data folder, `bundles/<release>/`: a copy of that release's
// assembled bundle, which runs started on it keep reading after the app updates.

import { APP_RELEASE_ENV, isRelease } from '@lar-factory/shared/run-settings';
import type { WorkRecords } from '@lar-factory/work-records';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/** The running app release, which only a packaged app passes; undefined when it can't name a folder. */
export function runningRelease(env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
    const release = env[APP_RELEASE_ENV];

    return isRelease(release) ? release : undefined;
}

/** The releases runs of active work started on; work is active until it is finished or set aside. */
function releasesInUse(records: WorkRecords): Set<string> {
    return new Set(
        records
            .list({})
            .filter((record) => !record.finishedAt && !record.setAside)
            .flatMap((record) => records.runSettings(record.workId).runs.map((run) => run.release))
            .filter((release) => release !== undefined),
    );
}

/**
 * Whether a temporary folder, `.<release>-<pid>-<time>`, was left by a copy whose process is gone, such as one killed
 * mid-copy. A folder whose process still runs may be a concurrent copy, and an unreadable name is left alone.
 */
function abandoned(name: string): boolean {
    const pid = Number(/-(\d+)-\d+$/.exec(name)?.[1]);

    if (!pid) return false;

    try {
        process.kill(pid, 0);

        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
}

/**
 * Copies `bundle` into `<dataDir>/bundles/<release>/` unless that folder exists, through a temporary folder renamed
 * into place, so a release folder is complete or absent. Then deletes every other folder there that no active run's
 * release names, never `release`'s, and every temporary folder an ended copy abandoned; without `records` it deletes nothing. A failure is logged, never thrown.
 */
export function refreshReleaseFolders(input: {
    bundle: string;
    dataDir: string;
    release: string;
    records: WorkRecords | null;
    log: (message: string) => void;
}): void {
    const { bundle, release, records, log } = input;
    const bundles = join(input.dataDir, 'bundles');
    const folder = join(bundles, release);

    if (!existsSync(folder)) {
        // A leading dot keeps it from naming any release.
        const temporary = join(bundles, `.${release}-${process.pid}-${Date.now()}`);

        try {
            mkdirSync(bundles, { recursive: true });
            cpSync(bundle, temporary, { recursive: true });
            renameSync(temporary, folder);
        } catch (error) {
            rmSync(temporary, { recursive: true, force: true });
            log(`Couldn't copy release ${release} into ${bundles}: ${(error as Error).message}`);
        }
    }

    if (!records) return;

    try {
        const keep = releasesInUse(records).add(release);

        for (const name of readdirSync(bundles))
            if (name.startsWith('.') ? abandoned(name) : !keep.has(name))
                rmSync(join(bundles, name), { recursive: true, force: true });
    } catch (error) {
        log(`Couldn't delete unused release folders in ${bundles}: ${(error as Error).message}`);
    }
}
