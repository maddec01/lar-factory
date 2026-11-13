import type { RetroSuggestion } from '@lar-factory/shared';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { refreshBoards } from './board-refresh.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

export async function retroCommand(command: string, args: string[]): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                revision: { type: 'string' },
                file: { type: 'string' },
            },
        });

        if (positionals.length !== 1) throw new Error('Name one build.');

        const id = positionals[0]!;

        records = await openWorkRecords(workRecordsPath(values['data-dir']));

        if (command === 'propose-retro') {
            if (!values.file || !values.revision) throw new Error('Use --revision N --file F with a suggestion array.');

            records.proposeRetro(
                id,
                Number(values.revision),
                JSON.parse(readFileSync(values.file === '-' ? 0 : values.file, 'utf8')) as RetroSuggestion[],
            );
            await refreshBoards(id, values['data-dir']);
        }

        process.stdout.write(`${JSON.stringify(records.retro(id), null, 2)}\n`);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
