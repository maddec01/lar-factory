// Auto-build: with the switch on, the board starts each eligible Ready build through Start build, oldest passing gate
// first and then by work ID, until the builds at work reach the build limit. A hold starts nothing, marks nothing on a
// build and retries on the next pass. Any other refused or failed start pauses automatic attempts on that build, kept in
// a JSON file in the data folder, until a Start build on it succeeds or a new gate passes. Only the board that owns the
// data folder's Auto-build lock starts builds, so two running boards never both do.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildsAtWork, isRecord, ref, type AutoBuildPass, type AutoBuildState, type Item, type ModelGroup, type StartResult } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { acquireOwnerLock, type OwnerLease, type WorkRecords } from '@lar-factory/work-records';
import type { BoardState } from '../board/board-state.ts';
import type { ItemCommands } from '../items/item-commands.ts';
import { readJsonRecord } from '../json-file.ts';
import { log } from '../log.ts';
import { findModelChoice } from '../t3/model-choices.ts';

export interface AutoBuild {
  /**
   * Shows what Auto-build finds now and, with the switch on, starts the eligible builds the build limit has room for.
   * A pass asked for while one runs runs once that one ends.
   */
  pass(): Promise<void>;
  /** Gives up the Auto-build lock, so another board may own it. */
  release(): Promise<void>;
}

export interface AutoBuildDeps {
  board: BoardState;
  /** Null in sample mode, which starts nothing. */
  records: WorkRecords | null;
  /** Auto-build passes `quiet`, as it shows a failure itself. */
  commands: Pick<ItemCommands, 'startBuild'>;
  /** The saved switch and model. */
  setting(): AutoBuildState;
  /** How many builds may work at once. */
  limit(): number;
  /** Reads the model choices T3 offers now into the board data; none when they can't be read. */
  offerModelChoices(): ModelGroup[];
  /** The data folder, which holds the pauses and the lock; tests give their own. */
  dir?: string;
}

/** A build's automatic pause: the error its start gave, and the gate it had then, so a new gate ends the pause. */
interface Pause { error: string; gateId: string | null }

const T3_UNREACHABLE = "Auto-build waits for T3, which the board can't reach.";
const MODELS_UNREADABLE = "Auto-build waits for T3's model choices, which the board can't read.";
const MODEL_GONE = "Auto-build's model isn't offered now. Choose another in Settings.";
const ANOTHER_BOARD = 'Another board on this Mac starts the builds.';

function readPauses(file: string): Record<string, Pause> {
  return Object.fromEntries(Object.entries(readJsonRecord(file) ?? {}).flatMap(([workId, entry]) =>
    isRecord(entry) && typeof entry.error === 'string' && (entry.gateId === null || typeof entry.gateId === 'string')
      ? [[workId, { error: entry.error, gateId: entry.gateId }]] : []));
}

export function createAutoBuild({ board, records, commands, setting, limit, offerModelChoices, dir = boardDataDir() }: AutoBuildDeps): AutoBuild {
  const file = join(dir, 'auto-build-pauses.json');
  let pauses = records ? readPauses(file) : {};
  let lease: OwnerLease | null = null;
  let running: Promise<void> | null = null;
  let again = false;

  /** The work's current passing gate, or null when its brief has none. */
  function passingGate(workId: string): { gateId: string; at: string } | null {
    const { current, briefDigest, evidence } = records!.gate(workId);
    if (!current) return null;
    const passed = evidence.findLast((gate) => gate.briefDigest === briefDigest && (gate.source === 'gate' || gate.source === 'user'));
    return passed ? { gateId: passed.gateId, at: passed.recordedAt } : null;
  }

  function savePauses(next: Record<string, Pause>): void {
    if (JSON.stringify(next) === JSON.stringify(pauses)) return;
    pauses = next;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(next));
    } catch (err) {
      log(`could not save Auto-build's paused builds to ${file}: ${(err as Error).message}`);
    }
  }

  /** Whether the board holds a build start that hasn't settled: one in flight, or one T3 may have made. */
  const startPending = (item: Item) => records!.launchIntents({ workId: item.id, unresolved: true }).some((intent) => intent.purpose === 'build')
    || !!board.snapshot().startedBuilds?.[item.id];

  /** The Ready builds that may start now, oldest passing gate first and then by work ID, and those waiting for Refinement. */
  function eligible(): { builds: Item[]; waitsForRefinement: string[] } {
    const data = board.snapshot();
    const waitsForRefinement: string[] = [];
    const builds = data.items.flatMap((item) => {
      if (item.status !== 'Ready' || item.kind === 'concept' || item.kind === 'decision' || item.archived || item.needsYou || data.armed?.[item.id]) return [];
      try {
        const record = records!.read(item.id);
        if (record.setAside || record.status !== 'Ready') return [];
        const gate = passingGate(item.id);
        if (!gate || pauses[item.id] || records!.specState(item.id).held || records!.waitingOn(item.id).length || startPending(item)) return [];
        if (record.parentId && records!.read(record.parentId).kind === 'concept' && !records!.refinement(record.parentId).complete) {
          waitsForRefinement.push(item.id);
          return [];
        }
        return [{ item, at: gate.at }];
      } catch (err) {
        log(`Auto-build can't read ${item.id}: ${(err as Error).message}`);
        return [];
      }
    });
    builds.sort((a, b) => a.at.localeCompare(b.at) || a.item.id.localeCompare(b.item.id));
    return { builds: builds.map(({ item }) => item), waitsForRefinement };
  }

  /** The builds at work, with the Ready ones whose start the board holds, so an unsettled start keeps its place. */
  const atWork = () => {
    const data = board.snapshot();
    const counted = new Set(buildsAtWork(data).map((item) => item.id));
    for (const item of data.items) if (item.status === 'Ready' && startPending(item)) counted.add(item.id);
    return counted.size;
  };

  /** Ends the pauses whose build started by a person's Start build, or whose brief passed a new gate since. */
  function endPauses(): void {
    savePauses(Object.fromEntries(Object.entries(pauses).filter(([workId, pause]) => {
      try {
        const record = records!.read(workId);
        return record.status === 'Ready' && !record.setAside && passingGate(workId)?.gateId === pause.gateId;
      } catch {
        return false;
      }
    })));
  }

  /** Why nothing may start now for every build, or null. */
  function hold(): string | null {
    const data = board.snapshot();
    if (data.t3Availability?.availability !== 'available') return T3_UNREACHABLE;
    const choices = offerModelChoices();
    if (!choices.length) return MODELS_UNREADABLE;
    const { model } = setting();
    if (model && !findModelChoice(choices, model)) return MODEL_GONE;
    return null;
  }

  /** Whether this board owns Auto-build, taking the lock when no live board holds it. */
  async function owns(): Promise<boolean> {
    if (lease) {
      try {
        await lease.assertOwned();
        return true;
      } catch {
        lease = null;
      }
    }
    try {
      lease = await acquireOwnerLock(join(dir, 'auto-build.lock'), () => new Error('Another board owns Auto-build now.'));
    } catch (err) {
      log(`Auto-build can't take its lock: ${(err as Error).message}`);
    }
    return lease !== null;
  }

  function show(pass: AutoBuildPass): void {
    if (JSON.stringify(board.snapshot().autoBuildPass) === JSON.stringify(pass)) return;
    board.update({ autoBuildPass: pass });
    board.push();
  }

  async function passOnce(): Promise<void> {
    if (!records) return;
    endPauses();
    const { builds, waitsForRefinement } = eligible();
    const room = () => Math.max(0, limit() - atWork());
    const shown = (held?: string | null) => ({ ...held && { hold: held }, wouldStart: Math.min(room(), builds.length),
      paused: Object.fromEntries(Object.entries(pauses).map(([workId, { error }]) => [workId, error])), waitsForRefinement });
    const { on, model } = setting();
    if (!on || !builds.length || !room()) return show(shown());
    const held = hold() ?? (await owns() ? null : ANOTHER_BOARD);
    if (held) return show(shown(held));
    let buildHold: string | null = null;
    for (const item of builds) {
      if (!room()) break;
      const { body } = await commands.startBuild(item.id, model, undefined, true);
      const { error, uncertain, hold: holds } = body as Partial<StartResult>;
      if (!error) {
        log(`Auto-build started ${ref(item)}`);
        continue;
      }
      // T3 may have made the thread; the start keeps its place and the existing recovery settles it.
      if (uncertain) continue;
      if (holds) {
        log(`Auto-build held ${ref(item)}: ${error}`);
        buildHold ??= error;
        continue;
      }
      log(`Auto-build paused ${ref(item)}: ${error}`);
      savePauses({ ...pauses, [item.id]: { error, gateId: passingGate(item.id)?.gateId ?? null } });
    }
    show({ ...shown(buildHold), wouldStart: Math.min(room(), eligible().builds.length) });
  }

  return {
    pass() {
      if (running) {
        again = true;
        return running;
      }
      running = (async () => {
        try {
          do {
            again = false;
            await passOnce();
          } while (again);
        } finally {
          running = null;
        }
      })();
      return running;
    },
    async release() {
      await running;
      await lease?.release();
      lease = null;
    },
  };
}
