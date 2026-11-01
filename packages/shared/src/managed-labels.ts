// The managed labels: those the factory reads as meaning, which it hides from rows and locks in settings. The names
// come from what reads them, so the reads, customLabelProblem and the lock can't disagree. Trackers match without case.
import { STATUS_LABEL_PREFIX, sameRepo } from './model.ts';
import type { Item, Kind, RepoConfig } from './model.ts';
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

/** The labels a row shows, in the ticket's order: none that are managed or that the repository maps to the item's kind. */
export function shownLabels(item: Pick<Item, 'kind' | 'labels'>, vocabulary?: EffectiveVocabulary): string[] {
  const mapped = new Set(kindLabels(item.kind, vocabulary));
  return item.labels.slice(0, LABEL_LIMIT).filter((label) => !isManagedLabel(label) && !mapped.has(label.toLowerCase()));
}

/** The labels `item`'s row shows, under its repository's mappings. */
export const labelsOnRow = (item: Pick<Item, 'kind' | 'labels' | 'repo'>, repos: readonly Pick<RepoConfig, 'repo' | 'setup'>[]): string[] =>
  shownLabels(item, repos.find((r) => sameRepo(r.repo, item.repo))?.setup?.vocabulary);
