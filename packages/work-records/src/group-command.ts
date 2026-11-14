import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { createAgentTicket } from './agent-tracker-writes.ts';
import { agentWrites } from './agent-writes.ts';
import { refreshBoards } from './board-refresh.ts';
import type { PartBatch } from './create-parts.ts';
import { syncSpecs } from './spec-sync.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

/** Provider calls follow the atomic local commit. Durable UUIDs recover uncertain or interrupted ticket creates. */
export async function syncPartTickets(
    id: string,
    records: WorkRecords,
    deps: Omit<Parameters<typeof createAgentTicket>[2], 'records'>,
) {
    const failures: string[] = [];

    for (const request of records.partTicketRequests(id)) {
        if (request.ticket) continue;

        const result = await createAgentTicket(
            request.workId,
            { revision: records.read(request.workId).revision, requestId: request.requestId },
            { ...deps, records },
        );

        if (result.body.error) failures.push(`${request.workId}: ${result.body.error}`);
    }

    return failures;
}

export async function groupCommand(command: string, args: string[]): Promise<number> {
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

        if (positionals.length !== 1) throw new Error('Name one group ID.');

        const id = positionals[0]!;

        records = agentWrites(await openWorkRecords(workRecordsPath(values['data-dir'])));

        const input =
            command === 'sync-part-tickets'
                ? null
                : JSON.parse(readFileSync(values.file === '-' ? 0 : (values.file ?? ''), 'utf8'));
        let result: unknown;

        if (command === 'create-parts') result = records.createParts(id, Number(values.revision), input as PartBatch);
        else if (command === 'sync-blockers') result = records.syncBlockers(id, input.revisions);
        else if (command === 'refresh-projections') result = records.refreshProjections(id, input.revisions, input);
        else if (command !== 'sync-part-tickets') throw new Error('Unknown group command.');

        const ticketErrors = ['create-parts', 'sync-part-tickets'].includes(command)
            ? await syncPartTickets(id, records, {
                  repos: () =>
                      readRepositorySetups(values['data-dir']).map((setup) => ({
                          repo: setup.repo,
                          setup,
                          labels: [],
                          role: setup.role ?? '',
                      })),
              })
            : [];

        await syncSpecs(records, { dir: values['data-dir'] });
        await refreshBoards(id, values['data-dir']);
        process.stdout.write(`${JSON.stringify({ result, ticketErrors }, null, 2)}\n`);

        return ticketErrors.length ? 1 : 0;
    } catch (error) {
        process.stderr.write(`lar-work: ${(error as Error).message}\n`);

        return 1;
    } finally {
        records?.close();
    }
}
