// Start after: the blocked parts whose start is armed, kept in a JSON file in the board server's data folder so they
// survive a restart. After each read the board starts every armed part whose blockers have all closed, on the model
// choice it was armed with: Start build for a Ready build, today's Start for a Queued item. A part whose repository is
// still onboarding waits for onboarding's PR to merge.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isOnboarding, isRecord, openBlockers, pickRepoText, startHold, startRepo } from '@lar-factory/shared';
import type { ArmedStart, Item, ModelGroup } from '@lar-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import type { ItemCommands, Reply } from '../items/item-commands.ts';
import { readJsonRecord } from '../json-file.ts';
import { log } from '../log.ts';
import { findModelChoice } from '../t3/model-choices.ts';

export interface StartAfter {
  /**
   * Arms a blocked Ready or Queued item's start on `model`, the model choice its menu picked, once T3 has its
   * repository's project; an untagged Azure work item's start also keeps `repo`, the repository picked for it.
   */
  arm(itemId: string, model: unknown, repo?: unknown): Reply;
  /** Disarms the item's start and clears the error its last one left. */
  disarm(itemId: string): Reply;
  /** Starts every armed part whose blockers have all closed and whose repository is done onboarding; a started or failed one is disarmed. */
  startUnblocked(): Promise<void>;
}

export interface StartAfterDeps {
  board: BoardState;
  commands: Pick<ItemCommands, 'start' | 'startBuild'>;
  /** Reads the model choices T3 offers now into the board data. */
  offerModelChoices(): ModelGroup[];
  /** The file armed starts live in; null in sample mode, which keeps none. */
  file: string | null;
}

const ARMABLE = ['Ready', 'Queued'];
const GONE = 'That item is no longer on the board.';

const isOpen = (item: Item) => openBlockers(item).length > 0;

/** The armed starts in `file`, leaving out any entry that isn't one. */
function readArmed(file: string | null): Record<string, ArmedStart> {
  const entries = Object.entries((file && readJsonRecord(file)) ?? {}).flatMap(([itemId, entry]) => {
    if (!isRecord(entry)) return [];
    const { model, repo } = entry;
    if (repo !== undefined && typeof repo !== 'string') return [];
    const picked = repo === undefined ? {} : { repo };
    if (model === undefined) return [[itemId, picked]];
    return isRecord(model) && typeof model.instanceId === 'string' && typeof model.model === 'string'
      ? [[itemId, { model: { instanceId: model.instanceId, model: model.model }, ...picked }]] : [];
  });
  return Object.fromEntries(entries);
}

export function createStartAfter({ board, commands, offerModelChoices, file }: StartAfterDeps): StartAfter {
  if (file) board.update({ armed: readArmed(file), armedErrors: {} });
  const armed = () => board.snapshot().armed ?? {};
  const errors = () => board.snapshot().armedErrors ?? {};
  const without = <T>(record: Record<string, T>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
  const withBoard = (status: number, body: object): Reply => ({ status, body: { ...body, board: board.snapshot() } });

  /** Writes `next` to the file, then shows it; returns the error when the file can't be written. */
  function save(next: Record<string, ArmedStart>, nextErrors: Record<string, string>): string | null {
    if (!file) return 'Start after is disabled in sample mode.';
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(next));
    } catch (err) {
      return `Could not save the armed starts to ${file}. ${(err as Error).message}`;
    }
    board.update({ armed: next, armedErrors: nextErrors });
    board.push();
    return null;
  }

  /** Disarms the part, then runs its start and keeps the error a failed one gives. */
  async function startNow(item: Item, { model, repo }: ArmedStart): Promise<void> {
    const failed = save(without(armed(), item.id), errors());
    if (failed) return log(failed);
    const { body } = await (item.status === 'Ready' ? commands.startBuild(item.id, model) : commands.start(item.id, model, repo));
    const { error } = body as { error?: string | null };
    if (!error) return log(`started #${item.number} after its blockers closed`);
    log(`could not start #${item.number} after its blockers closed: ${error}`);
    board.update({ armedErrors: { ...errors(), [item.id]: error } });
    board.push();
  }

  return {
    arm(itemId, model, picked) {
      const item = board.find(itemId);
      if (!item) return { status: 404, body: { error: GONE } };
      if (!ARMABLE.includes(item.status)) {
        return withBoard(409, { error: `Only Ready and Queued items can start after their blockers; this one is in ${item.status}.` });
      }
      if (!isOpen(item)) return withBoard(409, { error: 'Nothing blocks this item now. Start it instead.' });
      const repo = startRepo(item, picked);
      if (!repo) return withBoard(409, { error: pickRepoText(board.snapshot(), item) });
      // Its start would fail while its repository is onboarding or has no T3 project, so the hold shows now, not once its blockers close.
      const hold = startHold(board.snapshot(), repo);
      if (hold) return withBoard(409, { error: hold });
      let entry: ArmedStart = item.untaggedFor ? { repo } : {};
      if (model !== undefined) {
        const choice = findModelChoice(offerModelChoices(), model);
        if (!choice) return withBoard(422, { error: "That model choice isn't offered. Pick another one." });
        entry = { ...entry, model: choice };
      }
      const error = save({ ...armed(), [itemId]: entry }, without(errors(), itemId));
      return withBoard(error ? 500 : 200, { error });
    },

    disarm(itemId) {
      const error = save(without(armed(), itemId), without(errors(), itemId));
      return withBoard(error ? 500 : 200, { error });
    },

    async startUnblocked() {
      const runs = Object.entries(armed()).flatMap(([itemId, entry]) => {
        const item = board.find(itemId);
        // A part that left the board, or moved on from Ready or Queued, has nothing left to start.
        if (!item || !ARMABLE.includes(item.status)) {
          const error = save(without(armed(), itemId), errors());
          if (error) log(error);
          return [];
        }
        // A part whose repository is still onboarding stays armed until onboarding's PR merges.
        return isOpen(item) || isOnboarding(board.snapshot(), entry.repo ?? item.repo) ? [] : [startNow(item, entry)];
      });
      await Promise.all(runs);
    },
  };
}
