import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { agentWrites } from './agent-writes.ts';
import { scopeMarkdown } from './brief-scope.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** Local-only scope commands; checking and rendering never mutate or contact a tracker. */
export async function scopeCommand(command: string, args: string[]): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                revision: { type: 'string' },
                file: { type: 'string' },
                identity: { type: 'string' },
                evidence: { type: 'string' },
                markdown: { type: 'boolean' },
            },
        });

        if (positionals.length !== 1) throw new Error(`${command} needs one work ID.`);

        if (values.markdown && command !== 'confirmed-scope') throw new Error('--markdown is for confirmed-scope.');

        const id = positionals[0]!;

        records = agentWrites(await openWorkRecords(workRecordsPath(values['data-dir'])));

        if (command === 'confirm-scope') {
            if (!values.file || !values.revision || !values.identity || !values.evidence)
                throw new Error('Use --revision N --file F --identity person --evidence "explicit response".');

            records.confirmScope(
                id,
                Number(values.revision),
                JSON.parse(readFileSync(values.file === '-' ? 0 : values.file, 'utf8')),
                values.identity,
                values.evidence,
            );
        }

        const confirmed = records.confirmedScope(id);
        const result =
            command === 'brief-scope-check'
                ? records.briefScopeCheck(id)
                : command === 'choose-structure' && confirmed
                  ? records.chooseStructure(id)
                  : confirmed;

        if (!result) throw new Error('No confirmed scope. Run confirm-scope at understanding confirmation.');

        process.stdout.write(
            values.markdown && 'scope' in result ? scopeMarkdown(result.scope) : `${JSON.stringify(result, null, 2)}\n`,
        );

        return 'ok' in result && !result.ok ? 1 : 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
