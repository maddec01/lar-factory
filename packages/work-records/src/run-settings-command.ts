import type { RoleRunFinish, RoleRunInput, SnapshotRunInput } from '@lar-factory/shared/run-settings';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { agentWrites } from './agent-writes.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** These local evidence commands deliberately bypass tracker synchronization. */
export async function runSettingsCommand(command: string, args: string[]): Promise<number> {
    let records: WorkRecords | undefined;

    try {
        const { values, positionals } = parseArgs({
            args,
            allowPositionals: true,
            options: {
                'data-dir': { type: 'string' },
                revision: { type: 'string' },
                file: { type: 'string' },
                'run-id': { type: 'string' },
            },
        });

        if (positionals.length !== 1 || (command !== 'run-settings' && (!values.revision || !values.file)))
            throw new Error(
                `${command} needs a work ID${command === 'run-settings' ? '' : ', --revision N and --file F'}.`,
            );

        records = agentWrites(await openWorkRecords(workRecordsPath(values['data-dir'])));

        const workId = positionals[0]!;
        const input = () => JSON.parse(readFileSync(values.file === '-' ? 0 : values.file!, 'utf8'));
        const revision = Number(values.revision);
        const result =
            command === 'run-settings'
                ? records.runSettings(workId, values['run-id'])
                : command === 'snapshot-run'
                  ? records.snapshotRun(workId, revision, input() as SnapshotRunInput)
                  : command === 'start-role-run'
                    ? records.startRoleRun(workId, revision, input() as RoleRunInput)
                    : records.finishRoleRun(workId, revision, input() as RoleRunFinish);

        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

        return 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
