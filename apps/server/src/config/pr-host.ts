// The calls that open and follow the board's PRs on a repository, onboarding's, Edit's and Reset's: az's on Azure
// DevOps, gh's on GitHub, each named and shaped alike.

import { onAzure } from '@lar-factory/shared';
import { AZURE_REPOS } from '../azure/azure-repos.ts';
import {
  branchExists, branchHead, closePr, commitTree, createPr, defaultBranchHead, editPrBody, openPrFrom, prState, pushCommit, readBlob, reopenPr,
} from '../github/github.ts';

const GITHUB = { branchExists, branchHead, closePr, commitTree, createPr, defaultBranchHead, editPrBody, openPrFrom, prState, pushCommit, readBlob, reopenPr };

/** The calls that open and follow the repository's PRs. A caller's `run` stands in for that tool. */
export const prHost = (repo: string): typeof GITHUB => (onAzure(repo) ? AZURE_REPOS : GITHUB);
