import { sameRepo, writeAccessProblem, type RepositorySetup } from '@lar-factory/shared';

import type { StructureProvider } from './tracker-sync.ts';
import type { WorkRecords } from './work-records.ts';

/** Called under the Spec drain's cross-process lease; title writes never publish ungated brief text. */
export async function syncTitles(
    records: WorkRecords,
    provider: StructureProvider,
    setups: RepositorySetup[],
    workId?: string,
    assertOwned: () => Promise<void> = async () => {},
): Promise<void> {
    for (const change of records.titleProjections()) {
        if ((workId && change.workId !== workId) || (!workId && change.retryAfter > Date.now())) continue;

        const record = records.read(change.workId);
        const setup = setups.find((item) => sameRepo(item.repo, record.repository));

        if (!record.ticket || record.title !== change.title || setup?.writeRefinedSpec === false) {
            records.settleTitleProjection(change.workId, change.revision);
            continue;
        }

        try {
            if (!setup) throw Error('Add the repository before syncing its title.');

            const problem = writeAccessProblem(record.repository, 'edit-ticket', setup.access, {
                azureReadOnly: setup.azureReadOnly || process.env.LAR_FACTORY_AZURE_READ_ONLY === '1',
            });

            if (problem) throw Error(problem);

            if (!provider.replaceTitle) throw Error('The provider cannot write ticket titles.');

            const number = Number(record.ticket.match(/(?:#|\/)(\d+)$/)?.[1]);

            if (!number) throw Error('The ticket has no issue number.');

            await assertOwned();

            const remote = await (provider.readSpec ?? provider.read)(record.repository, number);

            if (records.read(record.workId).title !== change.title) continue;

            await assertOwned();

            if (remote.title !== change.title) await provider.replaceTitle(remote, change.title);

            records.settleTitleProjection(change.workId, change.revision);
        } catch (error) {
            records.settleTitleProjection(
                change.workId,
                change.revision,
                error instanceof Error ? error.message : String(error),
            );
        }
    }
}
