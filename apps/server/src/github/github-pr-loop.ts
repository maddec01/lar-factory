import type { LinkedPr } from '@lar-factory/shared';
import type { PrLoopState } from '@lar-factory/work-records';
import { readGithubPrLoop as read } from '@lar-factory/work-records/pr-review';

import { gh } from './github.ts';

export type { PrLoopRead } from '@lar-factory/work-records/pr-review';
export const readGithubPrLoop = (repo: string, number: number, pr: LinkedPr, previous: PrLoopState, run = gh) =>
    read(repo, number, pr, previous, run);
