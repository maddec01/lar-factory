// A machine limit setting: Automatic or a whole number from 1, in its own file in the factory's data folder.

import { isRecord, type HeavyCommandLimit } from '@lar-factory/shared';

import { machineSetting, type Saved } from './machine-setting.ts';

/** The saved limit, and why a file that couldn't be read or held an invalid value counts as Automatic. */
export type SavedLimit = Saved<{ limit: HeavyCommandLimit }>;

export interface LimitSetting {
    /** This machine's limit in `dir`. A missing file is Automatic; so is one it can't use, with the reason. */
    read(dir?: string): SavedLimit;
    /** Saves `limit` as this machine's setting in `dir`, replacing the old file whole. */
    write(limit: HeavyCommandLimit, dir?: string): HeavyCommandLimit;
}

const validLimit = (limit: unknown): limit is HeavyCommandLimit =>
    limit === 'automatic' || (Number.isSafeInteger(limit) && (limit as number) >= 1);

/** The setting `name`, such as "heavy command limit", kept in `file`. */
export function limitSetting(file: string, name: string): LimitSetting {
    const setting = machineSetting<{ limit: HeavyCommandLimit }>({
        file,
        name,
        fallback: { limit: 'automatic' },
        needs: 'needs a limit of "automatic" or a whole number from 1',
        parse: (json) => (isRecord(json) && validLimit(json.limit) ? { limit: json.limit } : null),
    });

    return { read: setting.read, write: (limit, dir) => setting.write({ limit }, dir).limit };
}
