import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { readFactorySettings } from './factory-settings.ts';
import { readReviewerDiff } from './reviewer-diff.ts';
import { selectReviewers } from './reviewer-selection.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** Read-only selection: no tracker sync, review-history writes or provider access. Run in the build checkout. */
export async function selectReviewersCommand(args: string[]): Promise<number> {
    let parsed;

    try {
        parsed = parseArgs({
            args,
            allowPositionals: true,
            options: {
                base: { type: 'string' },
                head: { type: 'string' },
                'data-dir': { type: 'string' },
                escalations: { type: 'string' },
            },
        });

        if (parsed.positionals.length !== 1 || !parsed.values.base || !parsed.values.head)
            throw new Error(
                'Expected select-reviewers <work ID> --base <SHA> --head <SHA> [--escalations F] [--data-dir D].',
            );
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 2;
    }

    let records: WorkRecords | undefined;

    try {
        const { base, head } = parsed.values;
        const workId = parsed.positionals[0]!;

        records = await openWorkRecords(workRecordsPath(parsed.values['data-dir']));
        records.read(workId);

        const { settings, problem } = readFactorySettings(parsed.values['data-dir']);
        const { root, diff } = readReviewerDiff(base!, head!);
        const requests = parsed.values.escalations ? JSON.parse(readFileSync(parsed.values.escalations, 'utf8')) : [];
        const reviewers = selectReviewers(settings, diff, requests);

        if (problem) process.stderr.write(`lar-work: ${problem}\n`);

        process.stdout.write(
            `${JSON.stringify({ workId, base, head, root, triggerVersion: 1, complete: diff.complete, reviewers }, null, 2)}\n`,
        );

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
