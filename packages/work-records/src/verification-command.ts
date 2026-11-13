import type { VerificationResult } from '@lar-factory/shared';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { refreshBoards } from './board-refresh.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** Direct local evidence; never changes a tracker or starts a second build. */
export async function verificationCommand(command: string, args: string[]): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                revision: { type: 'string' },
                file: { type: 'string' },
                pr: { type: 'string' },
                head: { type: 'string' },
            },
        });

        if (positionals.length !== 1) throw new Error(`${command} needs one work ID.`);

        const id = positionals[0]!;

        records = await openWorkRecords(workRecordsPath(values['data-dir']));

        if (command === 'record-verification') {
            if (!values.file || !values.revision)
                throw new Error('Use --revision N --file F with {pr,head,result,by,note,testSteps}.');

            records.recordVerification(
                id,
                Number(values.revision),
                JSON.parse(readFileSync(values.file === '-' ? 0 : values.file, 'utf8')) as Omit<
                    VerificationResult,
                    'id' | 'at'
                >,
            );
        } else if (command === 'verification-head') {
            if (!values.pr || !values.head)
                throw new Error('Use --pr owner/name#N --head SHA from a fresh provider read.');

            records.observeVerificationHead(id, values.pr, values.head);
        }

        process.stdout.write(`${JSON.stringify(records.verification(id), null, 2)}\n`);

        if (command !== 'verification') await refreshBoards(id, values['data-dir']);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
