import { WorkRecordError } from './database.ts';
import type { WorkRecords } from './work-records.ts';

/** Product questions belong on the desk; delivery ordering belongs in the blocker graph. */
export function requireProductQuestion(records: WorkRecords, workId: string, reason: string): void {
    if (
        !/\b(wait(?:ing)?|blocked|until|pending)\b/i.test(reason) ||
        !/\b(gate|approval|merge[ds]?|ready|done|finish(?:ed)?|complet(?:e|ed|ion)|state)\b/i.test(reason)
    )
        return;

    const namesWork = (name: string | null) => {
        if (!name) return false;

        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, name.length <= 2 ? 'u' : 'iu').test(
            reason,
        );
    };
    const other = records
        .list({})
        .find(
            (record) =>
                record.workId !== workId &&
                [record.workId, record.title, record.ticket, ...(record.title.match(/\b[A-Z]{2,3}\b/g) ?? [])].some(
                    namesWork,
                ),
        );

    if (other || /another (?:work )?item|other (?:work )?item/i.test(reason))
        throw new WorkRecordError(
            'invalid',
            'Waiting on another work item is an agent wait. Use add-blocker (or sync-blockers from brief declarations), then waiting-on; do not set Needs you.',
        );
}
