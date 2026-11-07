// A machine setting: one JSON file in the factory's data folder, never in a repository, so each machine keeps its own.
// A missing file reads as the default; so does one the setting can't use, with the reason.

import { boardDataDir } from '@lar-factory/shared/data-dir';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { WorkRecordError } from './database.ts';

/** The saved setting, and why a file that couldn't be read or held an invalid value counts as the default. */
export type Saved<T> = T & { problem?: string };

export interface MachineSetting<T> {
    /** This machine's setting in `dir`. A missing file is the default; so is one it can't use, with the reason. */
    read(dir?: string): Saved<T>;
    /** Saves `value` as this machine's setting in `dir`, replacing the old file whole. */
    write(value: T, dir?: string): T;
}

export interface SettingShape<T extends object> {
    /** The file in the data folder, such as "build-limit.json". */
    file: string;
    /** The setting's name in messages, such as "build limit". */
    name: string;
    /** What a missing or unusable file reads as. */
    fallback: T;
    /** The setting a file's JSON holds, or null when it holds none. */
    parse(json: unknown): T | null;
    /** What a valid setting needs, as in "needs a limit of ...". */
    needs: string;
}

export function machineSetting<T extends object>({
    file,
    name,
    fallback,
    parse,
    needs,
}: SettingShape<T>): MachineSetting<T> {
    const pathIn = (dir: string): string => join(dir, file);
    return {
        read(dir = boardDataDir()) {
            const path = pathIn(dir);
            let text: string;
            try {
                text = readFileSync(path, 'utf8');
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
                return { ...fallback, problem: `Can't read the ${name} setting ${path}: ${(error as Error).message}.` };
            }
            let json: unknown;
            try {
                json = JSON.parse(text);
            } catch (error) {
                return { ...fallback, problem: `The ${name} setting ${path} isn't JSON: ${(error as Error).message}.` };
            }
            return parse(json) ?? { ...fallback, problem: `The ${name} setting ${path} ${needs}.` };
        },
        write(value, dir = boardDataDir()) {
            const valid = parse(value);
            if (!valid) throw new WorkRecordError('invalid', `The ${name} setting ${needs}.`);
            const path = pathIn(dir);
            try {
                mkdirSync(dir, { recursive: true });
                writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify(valid, null, 2)}\n`);
                renameSync(`${path}.${process.pid}.tmp`, path);
            } catch (error) {
                throw new WorkRecordError(
                    'unwritable',
                    `Can't save the ${name} setting ${path}: ${(error as Error).message}.`,
                );
            }
            return valid;
        },
    };
}
