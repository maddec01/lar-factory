// An Azure Repos pull request as az repos pr show prints it, and its state on the board.

import type { LinkedPr } from '@lar-factory/shared';

/** A pull request as az repos pr show prints it. */
export interface AzurePr {
  pullRequestId: number;
  status: 'active' | 'completed' | 'abandoned';
}

/** A PR's state on the board: active is open, a draft too; completed is merged; abandoned is closed. */
export const prStateOf = (pr: Pick<AzurePr, 'status'>): LinkedPr['state'] =>
  (pr.status === 'completed' ? 'merged' : pr.status === 'abandoned' ? 'closed' : 'open');
