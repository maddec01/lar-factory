import { limitNumber, workingAgain, type BoardData } from '@lar-factory/shared';
import type { BuildPreparation } from '@lar-factory/work-records';

export type BuildStartSource = Pick<BuildPreparation, 'automatic' | 'conceptId'>;

/** Durable statuses/intents are counted in SQLite. Handed-back work running again also occupies a slot. */
export function buildPreparation(data: BoardData, source?: BuildStartSource): BuildPreparation {
    return {
        limit: data.buildLimit ? limitNumber(data.buildLimit) : 1,
        atWorkIds: data.items.filter((item) => workingAgain(item)).map((item) => item.id),
        ...source,
    };
}
