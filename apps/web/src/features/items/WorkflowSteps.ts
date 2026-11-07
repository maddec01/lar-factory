// List is outside the workflow; Done is its outcome. Tracks show the active steps between them.

import { STATUSES } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';

export const WORKFLOW_STEPS: readonly Status[] = STATUSES.filter((status) => status !== 'List' && status !== 'Done');
