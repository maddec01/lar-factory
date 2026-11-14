import { limitNumber, type BoardData } from '@lar-factory/shared';
import type { BuildPreparation } from '@lar-factory/work-records';

export type BuildStartSource = Pick<BuildPreparation, 'automatic' | 'conceptId' | 'manual'>;

/** Capacity is counted from durable factory reservations inside the atomic claim. */
export function buildPreparation(data: BoardData, source?: BuildStartSource): BuildPreparation {
    return {
        limit: data.buildLimit ? limitNumber(data.buildLimit) : 1,
        ...source,
    };
}
