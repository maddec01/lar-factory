// What the line's dossiers hold: every open concept, and every open item with sub-issues on the board, with its parts
// in the order they run. Each part's kind comes from its labels, what it waits on from its blocked-by issues, and its
// thread is its newest item thread.

import { blockerRef, decisionType, kindOf, openBlockers } from '@mux-factory/shared';
import type { Blocker, Item, ItemThread, Status, ThreadState } from '@mux-factory/shared';

const PART_KINDS = ['research', 'grill', 'prototype', 'build'] as const;
export type PartKind = (typeof PART_KINDS)[number];
export const DECISION_KINDS: readonly PartKind[] = ['research', 'grill', 'prototype'];

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
export const THREAD_GLYPH: Record<ThreadState, Status> = { running: 'In progress', 'needs you': 'Needs you', done: 'Done' };

/** Past waiting: a thread has taken it on, whatever it waited for. */
const STARTED: Status[] = ['In progress', 'Review', 'Verify', 'Ready to merge', 'Done'];

export const started = (item: Item) => STARTED.includes(item.status);
export const isDone = (item: Item) => item.status === 'Done' || item.state === 'CLOSED' || item.state === 'MERGED';
const childOf = (child: Item, parent: Item) => child.parent?.number === parent.number && child.parent.repo === parent.repo;
export const threadsOf = (item: Item): ItemThread[] => (Array.isArray(item.threads) ? item.threads : []);

/** `decision: grill`, `decision: prototype` and `decision: research` are decisions; everything else builds. */
export function partKind(item: Item): PartKind {
  const decision = decisionType(item);
  return DECISION_KINDS.find((k) => k === decision) ?? 'build';
}

/** The parent's sub-issues on the board, decisions before builds, in board order within a kind. */
export function partsOf(parent: Item, all: readonly Item[]): Part[] {
  return all.filter((c) => childOf(c, parent))
    .map((item) => ({ item, kind: partKind(item), waitsOn: item.blockers, thread: threadsOf(item)[0] }))
    .sort((a, b) => PART_KINDS.indexOf(a.kind) - PART_KINDS.indexOf(b.kind));
}

/** What still holds a part back: the issues it's blocked by that are open, while no thread has taken it on. */
export const openWaits = (part: Part): Blocker[] => (started(part.item) ? [] : openBlockers(part.item));

/** The issues `item` waits on, as one list of refs, another repository's without its owner. */
export const waitText = (item: Item, blockers: readonly Blocker[]) => blockers.map((b) => blockerRef(item, b, true)).join(', ');

/** Every open concept and open item with sub-issues on the board, as a dossier, where it or a part is in `items`, the main area's scope. */
export function dossiersOf(items: readonly Item[], all: readonly Item[]): DossierItems[] {
  const shown = new Set(items.map((i) => i.id));
  return all.filter((p) => p.number !== null && p.status !== 'List' && p.status !== 'Done'
    && (kindOf(p) === 'concept' || all.some((c) => childOf(c, p))))
    .map((parent) => ({ parent, parts: partsOf(parent, all) }))
    .filter(({ parent, parts }) => shown.has(parent.id) || parts.some((p) => shown.has(p.item.id)));
}

/** The ids of every item the dossiers show, parents and parts. */
export const inDossiers = (dossiers: readonly DossierItems[]) =>
  new Set(dossiers.flatMap(({ parent, parts }) => [parent.id, ...parts.map((p) => p.item.id)]));

/** The ids of every item the dossiers show as a part, leaving out their parents. */
export const partsInDossiers = (dossiers: readonly DossierItems[]) =>
  new Set(dossiers.flatMap(({ parts }) => parts.map((p) => p.item.id)));
