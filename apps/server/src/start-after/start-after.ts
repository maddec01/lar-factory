// Start after: the blocked parts whose start is armed, kept in a JSON file in the board server's data folder so they
// survive a restart. After each read the board starts every armed part whose blockers have all closed, on the model
// choice it was armed with: Start build for a Ready build, today's Start for a Queued item.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isRecord, openBlockers, repositoryProjectHint } from '@lar-factory/shared';
import type { ArmedStart, Item, ModelGroup } from '@lar-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import type { ItemCommands, Reply } from '../items/item-commands.ts';
import { readJsonRecord } from '../json-file.ts';
import { log } from '../log.ts';
import { findModelChoice } from '../t3/model-choices.ts';

export interface StartAfter {
  /** Arms a blocked Ready or Queued item's start on `model`, the model choice its menu picked, once T3 has its repository's project. */
  arm(itemId: string, model: unknown): Reply;
  /** Disarms the item's start and clears the error its last one left. */
  disarm(itemId: string): Reply;
  /** Starts every armed part whose blockers have all closed; a started or failed one is disarmed. */
  startUnblocked(): Promise<void>;
}

export interface StartAfterDeps {
  board: BoardState;
  commands: Pick<ItemCommands, 'start' | 'startBuild'>;
  /** Reads the model choices T3 offers now into the board data. */
  offerModelChoices(): ModelGroup[];
  /** The file armed starts live in; null in sample mode, which keeps none. */
  file: string | null;
  /** The item source's Item.id for an id armed starts were saved under before Item.id was the content's node id. */
  renamedId?(savedId: string): string | undefined;
}

const ARMABLE = ['Ready', 'Queued'];
const GONE = 'That item is no longer on the board.';

const isOpen = (item: Item) => openBlockers(item).length > 0;

/** The armed starts in `file`, leaving out any entry that isn't one. */
function readArmed(file: string | null): Record<string, ArmedStart> {
  const entries = Object.entries((file && readJsonRecord(file)) ?? {}).flatMap(([itemId, entry]) => {
    if (!isRecord(entry)) return [];
    const { model } = entry;
    if (model === undefined) return [[itemId, {}]];
    return isRecord(model) && typeof model.instanceId === 'string' && typeof model.model === 'string'
      ? [[itemId, { model: { instanceId: model.instanceId, model: model.model } }]] : [];
  });
  return Object.fromEntries(entries);
}

export function createStartAfter({ board, commands, offerModelChoices, file, renamedId }: StartAfterDeps): StartAfter {
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
  async function startNow(item: Item, { model }: ArmedStart): Promise<void> {
    const failed = save(without(armed(), item.id), errors());
    if (failed) return log(failed);
    const start = item.status === 'Ready' ? commands.startBuild : commands.start;
    const { body } = await start(item.id, model);
    const { error } = body as { error?: string | null };
    if (!error) return log(`started #${item.number} after its blockers closed`);
    log(`could not start #${item.number} after its blockers closed: ${error}`);
    board.update({ armedErrors: { ...errors(), [item.id]: error } });
    board.push();
  }

  /** Moves each armed start saved under an item's old id to the item's id now; it runs once the first read knows both. */
  function rekeyArmed(): void {
    const renames = new Map(Object.keys(armed()).flatMap((id) => {
      const now = board.find(id) ? undefined : renamedId?.(id);
      return now ? [[id, now]] : [];
    }));
    if (!renames.size) return;
    const error = save(Object.fromEntries(Object.entries(armed()).map(([id, entry]) => [renames.get(id) ?? id, entry])), errors());
    if (error) log(error);
  }

  return {
    arm(itemId, model) {
      const item = board.find(itemId);
      if (!item) return { status: 404, body: { error: GONE } };
      if (!ARMABLE.includes(item.status)) {
        return withBoard(409, { error: `Only Ready and Queued items can start after their blockers; this one is in ${item.status}.` });
      }
      if (!item.repo || item.number === null) return withBoard(409, { error: 'This item needs an issue before it can start.' });
      if (!isOpen(item)) return withBoard(409, { error: 'Nothing blocks this item now. Start it instead.' });
      // Its start would fail without the repository's T3 project, so the hint shows now, not once its blockers close.
      const hint = repositoryProjectHint(board.snapshot(), item.repo);
      if (hint) return withBoard(409, { error: hint });
      let entry: ArmedStart = {};
      if (model !== undefined) {
        const choice = findModelChoice(offerModelChoices(), model);
        if (!choice) return withBoard(422, { error: "That model choice isn't offered. Pick another one." });
        entry = { model: choice };
      }
      const error = save({ ...armed(), [itemId]: entry }, without(errors(), itemId));
      return withBoard(error ? 500 : 200, { error });
    },

    disarm(itemId) {
      const error = save(without(armed(), itemId), without(errors(), itemId));
      return withBoard(error ? 500 : 200, { error });
    },

    async startUnblocked() {
      rekeyArmed();
      const runs = Object.entries(armed()).flatMap(([itemId, entry]) => {
        const item = board.find(itemId);
        // A part that left the board, or moved on from Ready or Queued, has nothing left to start.
        if (!item || !ARMABLE.includes(item.status)) {
          const error = save(without(armed(), itemId), errors());
          if (error) log(error);
          return [];
        }
        return isOpen(item) ? [] : [startNow(item, entry)];
      });
      await Promise.all(runs);
    },
  };
}
