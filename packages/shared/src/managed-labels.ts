// The managed labels: those the factory reads as meaning, which it hides from rows and locks in settings. The names
// come from what reads them, so the reads, customLabelProblem and the lock can't disagree. Trackers match without case.
import { STATUS_LABEL_PREFIX } from './model.ts';
import type { Item, Kind } from './model.ts';
import { DECISION_LABEL_PREFIX, STRUCTURE_LABEL, TRACKER_KIND_NAMES } from './tracker-structure.ts';
import type { EffectiveVocabulary, VocabularyKey } from './vocabulary.ts';

const MANAGED_NAMES: readonly string[] = [STRUCTURE_LABEL, ...TRACKER_KIND_NAMES.flatMap(([, names]) => names)];
const MANAGED_PREFIXES = [DECISION_LABEL_PREFIX, STATUS_LABEL_PREFIX];

export const isManagedLabel = (name: string): boolean => {
  const typed = name.trim().toLowerCase();
  return MANAGED_NAMES.includes(typed) || MANAGED_PREFIXES.some((prefix) => typed.startsWith(prefix));
};

/** How many of a ticket's labels the board reads for its rows. */
export const LABEL_LIMIT = 100;

/** The vocabulary terms that map labels to a kind. */
const KIND_TERMS: Partial<Record<Kind, readonly VocabularyKey[]>> = {
  bug: ['bug'], feature: ['feature'], improvement: ['improvement'], concept: ['concept', 'concept-kind'], build: ['build'],
};

export const sameLabel = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The labels the repository maps to `kind`, in lower case. */
export const kindLabels = (kind: Kind, vocabulary?: EffectiveVocabulary): string[] =>
  (KIND_TERMS[kind] ?? []).flatMap((key) => vocabulary?.[key].labels ?? []).map((label) => label.toLowerCase());

/** The kinds item details can give an ordinary item. */
export const SWAP_KINDS = ['bug', 'feature', 'improvement'] as const;
export type SwapKind = typeof SWAP_KINDS[number];

/** Whether an item can change kind: an ordinary one, with or without a kind. Concepts, decisions and builds can't. */
export const kindCanChange = (kind: Kind): boolean => kind === 'issue' || (SWAP_KINDS as readonly Kind[]).includes(kind);

const SWAP_KIND_NAMES: readonly string[] = TRACKER_KIND_NAMES.filter(([kind]) => kindCanChange(kind)).flatMap(([, names]) => names);

/** Whether trackerKind reads `name` as a kind by itself, so a repository can map a kind to it. */
export const isKindName = (name: string): boolean => {
  const typed = name.trim().toLowerCase();
  return TRACKER_KIND_NAMES.some(([, names]) => names.includes(typed));
};

/** The names trackerKind reads as `kind`. */
export const kindNames = (kind: SwapKind): readonly string[] => TRACKER_KIND_NAMES.find(([named]) => named === kind)![1];

/**
 * What giving a ticket `kind` changes in `labels`, its labels now. It adds the new kind's own mapped labels, and only those,
 * since mapped terms of several kinds can conflict. It removes the other ordinary kinds' names and mapped labels, as a ticket
 * can carry another kind than the item's old one. The names meaning `kind` stay, and so do labels mapped to builds and concepts.
 */
export function kindLabelSwap(labels: readonly string[], kind: SwapKind, vocabulary?: EffectiveVocabulary): { add: string[]; remove: string[] } {
  const own = kindLabels(kind, vocabulary);
  const kept = new Set([...own, ...kindNames(kind), ...kindLabels('build', vocabulary), ...kindLabels('concept', vocabulary)]);
  const swapped = new Set([...SWAP_KIND_NAMES, ...SWAP_KINDS.flatMap((other) => kindLabels(other, vocabulary))]);
  return {
    add: (vocabulary?.[kind].labels ?? []).filter((label) => !labels.some((name) => sameLabel(name, label))),
    remove: labels.filter((label) => swapped.has(label.toLowerCase()) && !kept.has(label.toLowerCase())),
  };
}

/** The labels a row shows, in the ticket's order: none that are managed or that the repository maps to the item's kind. */
export function shownLabels(item: Pick<Item, 'kind' | 'labels'>, vocabulary?: EffectiveVocabulary, isManaged: (name: string) => boolean = isManagedLabel): string[] {
  const mapped = new Set(kindLabels(item.kind, vocabulary));
  return item.labels.slice(0, LABEL_LIMIT).filter((label) => !isManaged(label) && !mapped.has(label.toLowerCase()));
}
