// Heavy command limit on the board: how many heavy commands may run at once on this machine, as Settings shows and
// saves it.

import { availableParallelism, totalmem } from 'node:os';
import type { HeavyCommandLimit, HeavyCommandLimitState } from '@lar-factory/shared';
import { automaticHeavyCommandLimit, readHeavyCommandLimit, writeHeavyCommandLimit, WorkRecordError } from '@lar-factory/work-records';
import type { Reply } from './item-commands.ts';

export interface BoardHeavyCommandLimit {
  /** The saved limit as Settings shows it, with the number Automatic gives here. */
  state(): HeavyCommandLimitState;
  /** Saves Settings' `limit`, which also replaces a file the board can't use. */
  save(input: Record<string, unknown>): Reply;
}

export interface HeavyCommandLimitDeps {
  /** The board's data folder, where the setting lives; tests give their own. */
  dir?: string;
  /** The number Automatic gives; tests give their own. */
  automatic?: number;
  /** Shows the board as it is after a saved change. */
  changed?: () => void;
}

export function createHeavyCommandLimit({ dir, automatic = automaticHeavyCommandLimit(availableParallelism(), totalmem()), changed = () => {} }: HeavyCommandLimitDeps): BoardHeavyCommandLimit {
  return {
    state: () => ({ ...readHeavyCommandLimit(dir), automatic }),
    save({ limit }) {
      try {
        writeHeavyCommandLimit(limit as HeavyCommandLimit, dir);
      } catch (err) {
        if (!(err instanceof WorkRecordError)) throw err;
        return { status: err.code === 'invalid' ? 400 : 500, body: { error: err.message } };
      }
      changed();
      return { status: 200, body: { error: null } };
    },
  };
}
