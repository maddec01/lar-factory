// One scheduler for Auto-build and explicitly running concepts. Eligible gates share the machine capacity,
// ordered by gate age then work ID. A concept remains authorized with Auto-build off, until Pause or a scope change.
// Holds retry; definite failures pause the item until a manual start succeeds or a new gate passes. Unknown launches
// retain their durable intent and slot. One board owns automatic scheduling for the data folder.

import {
    blockedText,
    buildsAtWork,
    isRecord,
    ref,
    type AutoBuildPass,
    type AutoBuildState,
    type Item,
    type ModelGroup,
    type StartResult,
} from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { acquireOwnerLock, type OwnerLease, type WorkRecords } from '@lar-factory/work-records';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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
    release: () => Promise<void>;
}

export interface AutoBuildDeps {
    board: BoardState;
    /** Null in sample mode, which starts nothing. */
    records: WorkRecords | null;
    /** Auto-build passes `quiet`, as it shows a failure itself. */
    commands: Pick<ItemCommands, 'startBuild'>;
    /** The saved switch and model. */
    setting: () => AutoBuildState;
    /** How many builds may work at once. */
    limit: () => number;
    /** Reads the model choices T3 offers now into the board data; none when they can't be read. */
    offerModelChoices: () => ModelGroup[];
    /** The data folder, which holds the pauses and the lock; tests give their own. */
    dir?: string;
    /** The clock; tests give their own. */
    now?: () => number;
}

/** A build's automatic pause: the error its start gave, and the gate it had then, so a new gate ends the pause. */
interface Pause {
    error: string;
    gateId: string | null;
}

const T3_UNREACHABLE = "Builds wait for T3, which the board can't reach.";
const MODELS_UNREADABLE = "Builds wait for T3's model choices, which the board can't read.";
const MODEL_GONE = "Auto-build's model isn't offered now. Choose another in Settings.";
const ANOTHER_BOARD = 'Another board on this Mac starts the builds.';

/** How long a build Start build held waits before Auto-build tries it again, as each try rereads its Spec. */
export const HOLD_RETRY_MS = 30_000;

function readPauses(file: string): Record<string, Pause> {
    return Object.fromEntries(
        Object.entries(readJsonRecord(file) ?? {}).flatMap(([workId, entry]) =>
            isRecord(entry) &&
            typeof entry.error === 'string' &&
            (entry.gateId === null || typeof entry.gateId === 'string')
                ? [[workId, { error: entry.error, gateId: entry.gateId }]]
                : [],
        ),
    );
}

export function createAutoBuild({
    board,
    records,
    commands,
    setting,
    limit,
    offerModelChoices,
    dir = boardDataDir(),
    now = Date.now,
}: AutoBuildDeps): AutoBuild {
    const file = join(dir, 'auto-build-pauses.json');
    let pauses = records ? readPauses(file) : {};
    let lease: OwnerLease | null = null;
    let running: Promise<void> | null = null;
    let again = false;
    /** The builds Start build held, with why and when Auto-build may try each again. */
    const held = new Map<string, { error: string; retryAt: number }>();

    /** The work's current passing gate, or null when its brief has none. */
    const passingGate = (workId: string) => records!.gate(workId).passing;

    function savePauses(next: Record<string, Pause>): void {
        if (JSON.stringify(next) === JSON.stringify(pauses)) return;

        pauses = next;

        try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(next));
            renameSync(`${file}.${process.pid}.tmp`, file);
        } catch (err) {
            log(`could not save Auto-build's paused builds to ${file}: ${(err as Error).message}`);
        }
    }

    /** Whether the board holds a build start that hasn't settled: one in flight, or one T3 may have made. */
    const startPending = (item: Item) =>
        records!.launchIntents({ workId: item.id, unresolved: true }).some((intent) => intent.purpose === 'build') ||
        !!board.snapshot().startedBuilds?.[item.id];

    /**
     * Whether the board's item may start now: with the time of its passing gate, 'refinement' when it waits for its concept's
     * Refinement, or null. The board's own facts come first, as they need no read.
     */
    function startable(itemId: string): { at: string } | 'refinement' | null {
        const data = board.snapshot();
        const item = data.items.find((candidate) => candidate.id === itemId);

        if (
            !item ||
            item.status !== 'Ready' ||
            item.kind === 'concept' ||
            item.kind === 'decision' ||
            item.archived ||
            item.needsYou ||
            data.armed?.[item.id] ||
            pauses[item.id] ||
            blockedText(item)
        )
            return null;

        try {
            const record = records!.read(item.id);

            if (record.setAside || record.status !== 'Ready') return null;

            const gate = passingGate(item.id);

            if (!gate || records!.specState(item.id).held || records!.waitingOn(item.id).length || startPending(item))
                return null;

            if (record.parentId && records!.read(record.parentId).kind === 'concept') {
                const plan = records!.conceptBuildPlan(record.parentId);

                if (plan.run?.state === 'paused') return null;

                if (!records!.refinement(record.parentId).complete || (!plan.run && plan.holds.length))
                    return 'refinement';
            }

            return { at: gate.recordedAt };
        } catch (err) {
            log(`Auto-build can't read ${item.id}: ${(err as Error).message}`);

            return null;
        }
    }

    function conceptOf(item: Item): { id: string; explicit: boolean } | null {
        const parent = records!.read(item.id).parentId;

        return parent && records!.read(parent).kind === 'concept'
            ? { id: parent, explicit: records!.conceptBuildPlan(parent).run?.state === 'running' }
            : null;
    }

    /** The Ready builds that may start now, oldest passing gate first and then by work ID, and those waiting for Refinement. */
    function eligible(): { builds: Item[]; waitsForRefinement: string[] } {
        const waitsForRefinement: string[] = [];
        const builds = board.snapshot().items.flatMap((item) => {
            const found = startable(item.id);

            if (found === 'refinement') waitsForRefinement.push(item.id);

            return found && found !== 'refinement' ? [{ item, at: found.at }] : [];
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

    /**
     * Ends the pauses whose build left Ready, as a person's Start build moves it, or whose brief passed a new gate since.
     * A pause stays while its record can't be read or is set aside.
     */
    function endPauses(): void {
        savePauses(
            Object.fromEntries(
                Object.entries(pauses).filter(([workId, pause]) => {
                    try {
                        if (records!.read(workId).status !== 'Ready') return false;

                        const gate = passingGate(workId);

                        return !gate || gate.gateId === pause.gateId;
                    } catch (err) {
                        return (err as { code?: string }).code !== 'not-found';
                    }
                }),
            ),
        );
    }

    /** Why nothing may start now for every build, or null. */
    function hold(model?: AutoBuildState['model']): string | null {
        const data = board.snapshot();

        if (data.t3Availability?.availability !== 'available') return T3_UNREACHABLE;

        const choices = offerModelChoices();

        if (!choices.length) return MODELS_UNREADABLE;

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
            lease = await acquireOwnerLock(
                join(dir, 'auto-build.lock'),
                () => new Error('Another board owns Auto-build now.'),
            );
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

        records.reconcileConceptBuildRuns();
        endPauses();

        const { builds, waitsForRefinement } = eligible();
        let room = Math.max(0, limit() - atWork());
        /** The builds still eligible: a start, a pause or a change since the scan drops a build. */
        let waiting = builds.length;
        const shown = (held?: string | null) => ({
            ...(held && { hold: held }),
            wouldStart: Math.min(room, waiting),
            paused: Object.fromEntries(Object.entries(pauses).map(([workId, { error }]) => [workId, error])),
            waitsForRefinement,
        });
        const { on, model } = setting();

        const scheduled = builds.filter((item) => on || conceptOf(item)?.explicit);

        if (!scheduled.length || !room) return show(shown());

        const holds = hold() ?? ((await owns()) ? null : ANOTHER_BOARD);

        if (holds) return show(shown(holds));

        let buildHold: string | null = null;

        for (const item of scheduled) {
            if (!room) break;

            const retry = held.get(item.id);

            if (retry && retry.retryAt > now()) {
                buildHold ??= retry.error;
                continue;
            }

            held.delete(item.id);

            // An earlier start, or a change while it ran, may have made this build ineligible.
            const found = startable(item.id);

            if (!found || found === 'refinement') {
                waiting--;
                continue;
            }

            const concept = conceptOf(item);
            const choice = concept?.explicit ? undefined : model;
            const modelHold = hold(choice);

            if (modelHold) {
                buildHold ??= modelHold;
                continue;
            }

            const { body } = await commands.startBuild(item.id, choice, undefined, true, {
                automatic: !concept?.explicit,
                ...(concept && { conceptId: concept.id }),
            });
            const { error, uncertain, hold: passes } = body as Partial<StartResult>;

            if (passes && error) {
                log(`Auto-build held ${ref(item)}: ${error}`);
                held.set(item.id, { error, retryAt: now() + HOLD_RETRY_MS });
                buildHold ??= error;
                continue;
            }

            waiting--;

            // A start T3 may have made keeps its place, and the existing recovery settles it.
            if (!error || uncertain) room--;

            if (!error) log(`Auto-build started ${ref(item)}`);
            else if (!uncertain) {
                log(`Auto-build paused ${ref(item)}: ${error}`);
                savePauses({ ...pauses, [item.id]: { error, gateId: passingGate(item.id)?.gateId ?? null } });
            }
        }
        show(shown(buildHold));
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
