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
        const { head } = parsed.values;
        let base = parsed.values.base!;
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
        const verification = records.verification(workId);
        const rounds = records.reviewRounds(workId).filter((round) => !runId || round.runId === runId);
        const previous = records.reviewerSelection(workId);
        const reviewed = rounds.at(-1)?.base;
        const verifyReturn =
            verification.latest?.result === 'fail' && reviewed && head !== verification.latest.head
                ? { rejectedHead: verification.latest.head }
                : undefined;

        if (verifyReturn)
            base =
                previous?.verifyReturn && previous.head === head && previous.runId === runId
                    ? previous.base
                    : reviewed!;

        const { root, diff } = readReviewerDiff(base, head!);
        const requests = parsed.values.escalations ? JSON.parse(readFileSync(parsed.values.escalations, 'utf8')) : [];
        const reviewers = selectReviewers(settings, diff, requests).map((reviewer) => {
            const frozen = snapshot?.reviewers.find((entry) => entry.id === reviewer.id);

            const scoped = verifyReturn
                ? {
                      ...reviewer,
                      triggerVersion: 2 as const,
                      reason: `Verify rejection; delta ${base}..${head}; approver required. ${reviewer.reason}`,
                  }
                : reviewer;

            return frozen
                ? { ...scoped, instructions: frozen.instructions, target: snapshot!.roles[`reviewer:${reviewer.id}`] }
                : scoped;
        });

        const selection = {
            workId,
            ...(runId && { runId }),
            base: base!,
            head: head!,
            root,
            triggerVersion: verifyReturn ? 2 : 1,
            ...(verifyReturn && { verifyReturn }),
            complete: diff.complete,
            reviewers,
        };

        records.saveReviewerSelection(workId, selection);

        await refreshBoards(workId, parsed.values['data-dir']);

        if (problem) process.stderr.write(`lar-work: ${problem}\n`);

        process.stdout.write(`${JSON.stringify(selection, null, 2)}\n`);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
