import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { agentWrites } from './agent-writes.ts';
import { refreshBoards } from './board-refresh.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** Local parent delivery records; each write is revision checked and never contacts a provider. */
export async function releaseCommand(command: string, args: string[]): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                revision: { type: 'string' },
                file: { type: 'string' },
                step: { type: 'string' },
                identity: { type: 'string' },
                evidence: { type: 'string' },
                result: { type: 'string' },
            },
        });

        if (positionals.length !== 1) throw Error(`${command} needs one work ID.`);

        const id = positionals[0]!;

        records = agentWrites(await openWorkRecords(workRecordsPath(values['data-dir'])));

        if (command !== 'release-plan' && !values.revision) throw Error('Use --revision N from a fresh parent read.');

        const revision = Number(values.revision);

        if (command === 'set-release-plan') {
            if (!values.file) throw Error('Use --file F with {steps:[{id,who,what}],outcomeCheck:"observable check"}.');

            records.setReleasePlan(
                id,
                revision,
                JSON.parse(readFileSync(values.file === '-' ? 0 : values.file, 'utf8')),
            );
        } else if (command !== 'release-plan') {
            if (!values.identity || !values.evidence) throw Error('Use --identity person --evidence "done evidence".');

            if (command === 'complete-release-step') {
                if (!values.step) throw Error('Use --step ID.');

                records.completeReleaseStep(id, revision, values.step, values.identity, values.evidence);
            } else {
                if (values.result !== 'passed' && values.result !== 'failed')
                    throw Error('Use --result passed|failed.');

                records.recordOutcomeCheck(id, revision, values.result, values.identity, values.evidence);
            }
        }

        process.stdout.write(`${JSON.stringify(records.releasePlan(id), null, 2)}\n`);

        if (command !== 'release-plan') await refreshBoards(id, values['data-dir']);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
