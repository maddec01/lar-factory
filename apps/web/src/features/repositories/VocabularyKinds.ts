// The kinds a project's vocabulary maps to its tracker's labels and types, and the access their fields read.

import type { RepositorySetup } from '@lar-factory/shared';

export const KIND_NAMES = { bug: 'Bug', feature: 'Feature', improvement: 'Improvement' } as const;
export type VocabularyKind = keyof typeof KIND_NAMES;
export type VocabularyAccess = Pick<RepositorySetup, 'repo' | 'access' | 'azureReadOnly'>;
