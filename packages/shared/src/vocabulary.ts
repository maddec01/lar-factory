// Team vocabulary is browser-safe. Only discovery and settings persistence need Node.
import { isRecord } from './is-record.ts';
import type { RepositorySetup, SettingSource } from './model.ts';
import type { PublicationTicket, VocabularyTerm } from './publication.ts';

export const VOCABULARY_KEYS = ['concept', 'build', 'bug', 'feature', 'improvement', 'concept-kind'] as const;
export type VocabularyKey = typeof VOCABULARY_KEYS[number];
export type VocabularyMapping = Partial<Record<VocabularyKey, VocabularyTerm>>;
export type EffectiveVocabulary = Record<VocabularyKey, VocabularyTerm>;
export type VocabularySources = Record<VocabularyKey, SettingSource>;

export type VocabularyCapability =
  | { state: 'available'; choices: string[] }
  | { state: 'unsupported'; reason: string }
  | { state: 'refused'; reason: string };

export interface VocabularyDiscovery {
  provider: 'github' | 'azure';
  types: VocabularyCapability;
  labels: VocabularyCapability;
}

export const emptyVocabularyTerm = (): VocabularyTerm => ({ type: null, labels: [] });

export function isVocabularyMapping(raw: unknown): raw is VocabularyMapping {
  return isRecord(raw) && Object.entries(raw).every(([key, term]) => VOCABULARY_KEYS.includes(key as VocabularyKey)
    && isRecord(term) && Object.keys(term).every((k) => k === 'type' || k === 'labels')
    && (term.type === null || typeof term.type === 'string' && term.type.trim().length > 0)
    && Array.isArray(term.labels) && term.labels.every((v) => typeof v === 'string' && v.trim().length > 0)
    && new Set(term.labels).size === term.labels.length);
}

/** Each local mapping is complete, including an explicit choice of no type or labels. */
export function effectiveVocabulary(local: VocabularyMapping = {}): {
  vocabulary: EffectiveVocabulary; vocabularySources: VocabularySources;
} {
  return {
    vocabulary: Object.fromEntries(VOCABULARY_KEYS.map((key) => [key, local[key] ?? emptyVocabularyTerm()])) as EffectiveVocabulary,
    vocabularySources: Object.fromEntries(VOCABULARY_KEYS.map((key) => [key, local[key] !== undefined ? 'local' : 'default'])) as VocabularySources,
  };
}

type Resolution = {
  vocabulary: PublicationTicket['vocabulary'];
  typeResolution: PublicationTicket['typeResolution'];
  labels: string[];
};
export type VocabularyResolution = (Resolution & { ready: true }) | (Omit<Resolution, 'typeResolution'> & {
  ready: false; candidates: string[]; requests: { key: VocabularyKey; type: string }[];
});

/** A conflict remains unresolved until the user selects a candidate or explicitly selects none. */
export function resolveVocabulary(mapping: EffectiveVocabulary, scope: 'concept' | 'build', kind: 'bug' | 'feature' | 'improvement' | 'concept' | undefined, selected?: string | null): VocabularyResolution {
  const keys: VocabularyKey[] = [scope, ...(kind === undefined ? [] : [kind === 'concept' ? 'concept-kind' as const : kind])];
  const vocabulary = Object.fromEntries(keys.map((key) => [key, mapping[key]]));
  const requests = keys.flatMap((key) => mapping[key].type === null ? [] : [{ key, type: mapping[key].type! }]);
  const candidates = [...new Set(requests.map((r) => r.type))];
  const labels = [...new Set(keys.flatMap((key) => mapping[key].labels))];
  if (selected !== undefined && selected !== null && !candidates.includes(selected)) throw new Error('Choose one requested type or none.');
  if (candidates.length > 1 && selected === undefined) return { ready: false, vocabulary, labels, candidates, requests };
  return { ready: true, vocabulary, labels, typeResolution: { candidates, selected: selected === undefined ? candidates[0] ?? null : selected } };
}

/** Snapshot the effective destination and mappings. Engines compare this again before each outstanding write. */
export function publicationSettingsSnapshot(setup: RepositorySetup): string {
  return JSON.stringify({ repository: setup.repo, itemSource: setup.itemSource,
    vocabulary: VOCABULARY_KEYS.map((key) => [key, setup.vocabulary[key]]) });
}

/** Settings can discover existing terms or save a complete explicit mapping. */
export type VocabularySettingsRequest =
  | { repo: string; change: 'discover-vocabulary' }
  | { repo: string; change: 'vocabulary'; key: VocabularyKey; value: VocabularyTerm };

export interface VocabularySettingsResponse {
  setup: RepositorySetup;
  discovery?: VocabularyDiscovery;
}
