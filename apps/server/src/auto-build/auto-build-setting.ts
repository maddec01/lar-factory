// Auto-build on the board: this machine's switch, from the Ready to build header, and the model Settings chose for it.

import type { AutoBuild, AutoBuildState, ModelGroup } from '@lar-factory/shared';
import { readAutoBuild, writeAutoBuild, WorkRecordError } from '@lar-factory/work-records';
import type { Reply } from '../items/item-commands.ts';
import { findModelChoice } from '../t3/model-choices.ts';

export interface BoardAutoBuild {
  /** The saved switch and model, or off with why the file can't be used. */
  state(): AutoBuildState;
  /** Saves the switch `on`, or the `model` choice (null for T3 Project default), keeping the other; it also replaces a file the board can't use. */
  save(input: Record<string, unknown>): Reply;
}

export interface AutoBuildDeps {
  /** The board's data folder, where the setting lives; tests give their own. */
  dir?: string;
  /** Reads the model choices T3 offers now into the board data. */
  offerModelChoices(): ModelGroup[];
  /** Shows the board as it is after a saved change. */
  changed?: () => void;
}

export function createAutoBuildSetting({ dir, offerModelChoices, changed = () => {} }: AutoBuildDeps): BoardAutoBuild {
  return {
    state: () => readAutoBuild(dir),
    save({ on, model }) {
      if ((on === undefined) === (model === undefined) || (on !== undefined && typeof on !== 'boolean')) {
        return { status: 400, body: { error: 'Send the Auto-build switch as true or false, or its model choice.' } };
      }
      const saved = readAutoBuild(dir);
      // A file the board can't use reads as off on T3 Project default, and this save replaces it.
      let next: AutoBuild = { on: saved.on, ...saved.model && { model: saved.model } };
      if (on !== undefined) next = { ...next, on: on as boolean };
      if (model === null) next = { on: next.on };
      else if (model !== undefined) {
        const choice = findModelChoice(offerModelChoices(), model);
        if (!choice) return { status: 422, body: { error: "That model choice isn't offered. Pick another one." } };
        next = { on: next.on, model: choice };
      }
      try {
        writeAutoBuild(next, dir);
      } catch (err) {
        if (!(err instanceof WorkRecordError)) throw err;
        return { status: err.code === 'invalid' ? 400 : 500, body: { error: err.message } };
      }
      changed();
      return { status: 200, body: { error: null } };
    },
  };
}
