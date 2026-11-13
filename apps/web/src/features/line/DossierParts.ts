// What the dock's dossiers hold: explicitly grouped work, including parts whose parents are off-board, with its parts
// in the order they run. Each part's kind comes from its local record, what it waits on from its blockers, and its
// thread is its newest item thread.

import {
    blockerRef,
    currentBuildThread,
    decisionType,
    delegatedWorkRunning,
    isDossierParent,
    methodName,
    openBlockers,
    openQuestionThread,
    plural,
    refKey,
} from '@lar-factory/shared';
import type { Blocker, Item, ItemThread, Status, ThreadState } from '@lar-factory/shared';

const PART_KINDS = ['research', 'grill', 'prototype', 'task', 'decision', 'build'] as const;

export type PartKind = (typeof PART_KINDS)[number];
export const DECISION_KINDS: readonly PartKind[] = ['research', 'grill', 'prototype', 'task', 'decision'];

export interface Part {
    item: Item;
    kind: PartKind;
    /** Every issue the part is blocked by, open or closed. */
    waitsOn: Blocker[];
    /** Its newest item thread, if any. */
    thread: ItemThread | undefined;
}

export interface DossierItems {
    parent: Item;
    parts: Part[];
}

/** A thread's state, drawn with the glyph of the status it reads as. */
export const THREAD_GLYPH: Record<ThreadState, Status> = {
    running: 'In progress',
    'needs you': 'Needs you',
    stopped: 'Needs you',
    done: 'Done',
};

/** Whether the thread, a descendant or a background task of it is at work, even after the thread's own turn ended. T3 can't vouch for a last-seen state. */
export const threadAtWork = (thread: ItemThread): boolean =>
    !thread.observedAt && (thread.state === 'running' || !!thread.hasRunningChildren);

/** The thread a part shows: its running build thread while it is at work again, else the one at work, as running, else its newest. */
export function shownThread(part: Part, working = false): ItemThread | undefined {
    const atWork = (working ? currentBuildThread(part.item) : undefined) ?? threadsOf(part.item).find(threadAtWork);

    return atWork ? { ...atWork, state: 'running' } : part.thread;
}

/** What a part's threads and their descendants do now. */
export interface PartActivity {
    kind: 'needs you' | 'working' | 'child waiting' | 'stopped' | 'finished' | 'none';
    /** The thread that says so, which Open thread opens. */
    thread: ItemThread | undefined;
}

/** Reads every thread of the part, since its newest can have finished while an older one, a child, a background task or a slice works on. While `unavailable`, the board can't say what any of them does now, so only a question and `working` count. */
export function partActivity(part: Part, working = false, unavailable = false): PartActivity {
    const { item } = part;
    const question = openQuestionThread(item);

    if (question) return { kind: 'needs you', thread: question };

    const thread = shownThread(part, working);

    if (unavailable && !working) return { kind: 'none', thread };

    if (thread?.state === 'running' || working || delegatedWorkRunning(item)) return { kind: 'working', thread };

    const waiting = threadsOf(item).find((t) => !t.observedAt && (t.hasLiveChildren || t.queued));

    if (waiting) return { kind: 'child waiting', thread: waiting };

    if (!thread) return { kind: 'none', thread };

    return { kind: thread.state === 'stopped' ? 'stopped' : 'finished', thread };
}

/** Finished and quiet: complete, with nothing of it still at work or waiting on the user. */
export const isHistory = (part: Part): boolean =>
    isDone(part.item) && ['stopped', 'finished', 'none'].includes(partActivity(part).kind);

/** Past waiting: a thread has taken it on, whatever it waited for. */
const STARTED: Status[] = ['In progress', 'Review', 'Verify', 'Ready to merge', 'Done'];

const started = (item: Item) => STARTED.includes(item.status);

export const isDone = (item: Item): boolean =>
    item.completion?.complete ?? (item.status === 'Done' || item.state === 'closed');

const childOf = (child: Item, parent: Item) => child.parentId === parent.id;

export const threadsOf = (item: Item): ItemThread[] => (Array.isArray(item.threads) ? item.threads : []);

/** Local kind is authoritative. Legacy source labels can still name a decision method. */
export function partKind(item: Item): PartKind {
    const decision = decisionType(item);

    if (item.kind === 'decision') return DECISION_KINDS.find((kind) => kind === decision) ?? 'decision';

    if (item.recorded === true) return 'build';

    return DECISION_KINDS.find((kind) => kind === decision) ?? 'build';
}

/** How a part names its kind: a decision by its method, or No method when it names no valid one. */
export const partLabel = (kind: PartKind): string => (kind === 'build' ? 'Build' : methodName(kind));

/** The parts each part waits on: a recorded blocker by its work ID, a ticket's blocker by its ticket, since ticketless parts share number 0. */
export function upstreamOf(parts: readonly Part[]): (part: Part) => Part[] {
    const byId = new Map(parts.map((p) => [p.item.id, p]));
    const byTicket = new Map(parts.filter((p) => p.item.number).map((p) => [refKey(p.item.repo, p.item.number), p]));

    return (part) =>
        part.waitsOn.flatMap(
            (b) =>
                (b.workId ? byId.get(b.workId) : b.number ? byTicket.get(refKey(b.repo, b.number)) : undefined) ?? [],
        );
}

/** Dependency waves shared by the checklist and Map, by work ID. External blockers do not add a wave; cycles stop at a seen part. */
export function partWaves(parts: Part[]): Map<string, number> {
    const ups = upstreamOf(parts);
    const depth = new Map<string, number>();
    const at = (p: Part, path: string[]): number => {
        const known = depth.get(p.item.id);

        if (known !== undefined) return known;

        const before = ups(p).filter((u) => !path.includes(u.item.id));
        const d = before.length ? Math.max(...before.map((u) => at(u, [...path, p.item.id]))) + 1 : 0;

        depth.set(p.item.id, d);

        return d;
    };

    parts.forEach((p) => at(p, []));

    return depth;
}

/** The parent's sub-issues by dependency wave, then kind, in board order for ties. */
export function partsOf(parent: Item, all: readonly Item[]): Part[] {
    const parts = all
        .filter((c) => childOf(c, parent))
        .map((item) => ({ item, kind: partKind(item), waitsOn: item.blockers, thread: threadsOf(item)[0] }))
        .sort((a, b) => PART_KINDS.indexOf(a.kind) - PART_KINDS.indexOf(b.kind));
    const waves = partWaves(parts);

    return parts.sort((a, b) => waves.get(a.item.id)! - waves.get(b.item.id)!);
}

/** What still holds a part back: the issues it's blocked by that are open, while no thread has taken it on. */
export const openWaits = (part: Part): Blocker[] => (started(part.item) ? [] : openBlockers(part.item));

/** The issues `item` waits on, as one list of refs, another repository's without its owner. */
export const waitText = (item: Item, blockers: readonly Blocker[]) =>
    blockers.map((b) => blockerRef(item, b, true)).join(', ');

/** Group roots and off-board parents' parts, where the root or a part is in the main area's scope. */
export function dossiersOf(items: readonly Item[], all: readonly Item[]): DossierItems[] {
    const shown = new Set(items.map((i) => i.id));

    return all
        .filter((p) => isDossierParent(p, all))
        .map((parent) => ({ parent, parts: partsOf(parent, all) }))
        .filter(({ parent, parts }) => shown.has(parent.id) || parts.some((p) => shown.has(p.item.id)));
}

/** How many of `parent`'s parts its records count that the board doesn't list: archived, or in a removed project. */
export const unreadParts = (parent: Item, parts: readonly Part[]): number =>
    Math.max(parent.subIssues.total, parts.length) - parts.length;

/** Why a count holds parts no list shows, in the same words wherever the count is. */
export const unreadPartsText = (missing: number): string =>
    `${plural(missing, 'part')} ${missing === 1 ? 'isn’t' : 'aren’t'} on the board: archived, or in a project removed from the board`;
