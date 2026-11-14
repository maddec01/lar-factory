import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { refreshBoards } from './board-refresh.ts';
import { readFactorySettings } from './factory-settings.ts';
import { readReviewerDiff } from './reviewer-diff.ts';
import { selectReviewers } from './reviewer-selection.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** Starts Review atomically after selection succeeds; no tracker sync or provider access. */
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
                'run-id': { type: 'string' },
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

        const runId = parsed.values['run-id'];
        const runs = records.runSettings(workId, runId).runs;

        if (!runId && runs.length) throw new Error('This work has run settings; select-reviewers requires --run-id.');

        const snapshot = runId ? runs[0] : undefined;

        if (snapshot && snapshot.kind !== 'build') throw new Error('Reviewer selection needs a build run.');

        const { settings, problem } = snapshot
            ? { settings: snapshot.settings, problem: null }
            : readFactorySettings(parsed.values['data-dir']);
        const { root, diff } = readReviewerDiff(base!, head!);
        const requests = parsed.values.escalations ? JSON.parse(readFileSync(parsed.values.escalations, 'utf8')) : [];
        const reviewers = selectReviewers(settings, diff, requests).map((reviewer) => {
            const frozen = snapshot?.reviewers.find((entry) => entry.id === reviewer.id);

            return frozen
                ? { ...reviewer, instructions: frozen.instructions, target: snapshot!.roles[`reviewer:${reviewer.id}`] }
                : reviewer;
        });

        const selection = {
            workId,
            ...(runId && { runId }),
            base: base!,
            head: head!,
            root,
            triggerVersion: 1,
            complete: diff.complete,
            reviewers,
        };

        records.saveReviewerSelection(workId, selection);

        await refreshBoards(workId, parsed.values['data-dir']);

        if (problem) process.stderr.write(`lar-work: ${problem}\n`);

        process.stdout.write(
            `${JSON.stringify({ workId, ...(runId && { runId }), base, head, root, triggerVersion: 1, complete: diff.complete, reviewers }, null, 2)}\n`,
        );

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
