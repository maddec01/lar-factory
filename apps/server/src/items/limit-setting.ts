// Machine limits on the board: how many heavy commands, and how many builds, may run at once on this machine, as
// Settings shows and saves them.

import { limitNumber, type HeavyCommandLimit, type HeavyCommandLimitState } from '@lar-factory/shared';
import {
    automaticHeavyCommandLimit,
    buildLimitSetting,
    heavyCommandLimitSetting,
    WorkRecordError,
    type LimitSetting,
} from '@lar-factory/work-records';
import { availableParallelism, totalmem } from 'node:os';

import type { Reply } from './item-commands.ts';

export interface BoardLimitSetting {
    /** The saved limit as Settings shows it, with the number Automatic gives here. */
    state(): HeavyCommandLimitState;
    /** Saves Settings' `limit`, which also replaces a file the board can't use. */
    save(input: Record<string, unknown>): Reply;
}

export interface LimitSettingDeps {
    /** The board's data folder, where the settings live; tests give their own. */
    dir?: string;
    /** The number Automatic gives the heavy command limit; tests give their own. */
    automatic?: number;
    /** Shows the board as it is after a saved change. */
    changed?: () => void;
}

function boardLimit(
    setting: LimitSetting,
    automatic: () => number,
    { dir, changed = () => {} }: LimitSettingDeps,
): BoardLimitSetting {
    return {
        state: () => ({ ...setting.read(dir), automatic: automatic() }),
        save({ limit }) {
            try {
                setting.write(limit as HeavyCommandLimit, dir);
            } catch (err) {
                if (!(err instanceof WorkRecordError)) throw err;
                return { status: err.code === 'invalid' ? 400 : 500, body: { error: err.message } };
            }
            changed();
            return { status: 200, body: { error: null } };
        },
    };
}

/** The heavy command limit, and the build limit, whose Automatic is the heavy command limit's number now. */
export function createLimitSettings(deps: LimitSettingDeps): {
    heavyCommandLimit: BoardLimitSetting;
    buildLimit: BoardLimitSetting;
} {
    const automatic = deps.automatic ?? automaticHeavyCommandLimit(availableParallelism(), totalmem());
    const heavyCommandLimit = boardLimit(heavyCommandLimitSetting, () => automatic, deps);
    return {
        heavyCommandLimit,
        buildLimit: boardLimit(buildLimitSetting, () => limitNumber(heavyCommandLimit.state()), deps),
    };
}
