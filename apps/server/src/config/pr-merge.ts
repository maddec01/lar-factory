import { onAzure, type LinkedPr, type MergeMethod } from '@lar-factory/shared';

import { azureMerge } from '../azure/azure-merge.ts';
import { githubMerge } from '../github/github-merge.ts';

export interface MergeProvider {
    read(repo: string, number: number): Promise<{ pr: LinkedPr; methods: readonly MergeMethod[]; blockers: string[] }>;
    merge(repo: string, number: number, revision: string, method: MergeMethod): Promise<void>;
}

/** Both providers expose evidence reads and one revision-guarded merge, never auto-merge or policy bypass. */
export const mergeProvider = (repo: string): MergeProvider => (onAzure(repo) ? azureMerge() : githubMerge());
