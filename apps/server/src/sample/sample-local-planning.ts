import { refKey, type BoardData, type Item, type ItemDetails } from '@lar-factory/shared';

import detailFixture from '../../../../packages/shared/test/sample-details.json' with { type: 'json' };

const fixtureDetails = detailFixture as unknown as Record<string, ItemDetails>;

/**
 * The fixture's recorded work (`recorded: true`): local planning such as a concept with ticketless parts, retired parts,
 * its build plan and reconciliation report, and Queued work. The fake tracker holds tickets only, so the sample shows
 * this work as the fixture holds it, in place of any ticket of it the item source read.
 */
export function sampleLocalPlanning(fixture: BoardData) {
    const local = fixture.items.filter((item) => item.recorded === true);
    const ids = new Set(local.map((item) => item.id));
    const tickets = new Set(
        local.filter((item) => item.number).map((item) => refKey(item.repo, item.number).toLowerCase()),
    );

    return {
        /** `items` with the recorded fixture work first, less the unrecorded copies of its tickets. */
        project(items: Item[]): Item[] {
            return [
                ...local,
                ...items.filter(
                    (item) => !ids.has(item.id) && !tickets.has(refKey(item.repo, item.number).toLowerCase()),
                ),
            ];
        },
        /** The fixture's details for recorded work it holds them for; undefined for any other item. */
        details(item: Item): ItemDetails | undefined {
            return ids.has(item.id) ? fixtureDetails[item.id] : undefined;
        },
    };
}
