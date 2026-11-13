import {
    sampleActivityFrom,
    sameLabel,
    type LabelChange,
    SETTLED_FIRST_READ,
    trackerCapabilities,
    type BoardData,
    type Item,
} from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { discoverTicketOptions } from '@lar-factory/shared/publication-settings';
import { openWorkRecords } from '@lar-factory/work-records';
import { join } from 'node:path';

import type { BoardState } from '../board/board-state.ts';
import { changeRepositoryLabels } from '../config/repository-labels.ts';
import { changeRepositorySettings } from '../config/repository-settings.ts';
import { createItemDetails, recordDetails } from '../item-details/item-details.ts';
import { createCapture } from '../items/capture.ts';
import { createItemCommands } from '../items/item-commands.ts';
import { mergeSources } from '../items/item-sources.ts';
import { recordItems } from '../items/record-items.ts';
import { fakeItemSource } from './fake-item-source.ts';
import { createFakeTracker } from './fake-tracker.ts';
import { sampleProvider, sampleRepositories, sampleVocabulary } from './sample-adapters.ts';
import { sampleControls } from './sample-controls.ts';

/** All writable sample dependencies live here. No real source, tracker or T3 command is reachable from them. */
export async function createSampleBoard(board: BoardState, fixture: BoardData) {
    const tracker = createFakeTracker({ mode: 'sample' });
    const dir = boardDataDir();
    const repos = sampleRepositories(tracker, dir);
    const records = await openWorkRecords(join(dir, 'work-records.db'));
    const sources = new Map(repos().map(({ repo }) => [repo, fakeItemSource(tracker, repo)]));
    const items = mergeSources(sources, new Map([...sources.values()].map((source) => [source, 'issues' as const])));
    const vocabulary = sampleVocabulary(tracker);
    let tickets: Item[] = [];
    const reread = () => {
        const configs = repos();
        const projected = recordItems(
            records,
            tickets,
            configs.map((r) => r.repo),
            [],
            new Set(),
            configs.flatMap((r) => (r.setup ? [r.setup] : [])),
        );

        // The fake tracker owns sample relationships; capture records supply stable IDs and local kinds.
        const byTicket = new Map(tickets.map((item) => [`${item.repo}#${item.number}`, item]));
        const shownIds = new Map(
            projected.flatMap((item) => {
                const ticket = byTicket.get(`${item.repo}#${item.number}`);

                return ticket ? [[ticket.id, item.id] as const] : [];
            }),
        );

        board.update({
            repos: configs,
            items: projected.map((item) => {
                const ticket = byTicket.get(`${item.repo}#${item.number}`);

                if (!ticket) return item;

                return {
                    ...(item.recorded === false ? { ...ticket, recorded: false } : item),
                    parentId: ticket.parentId ? (shownIds.get(ticket.parentId) ?? ticket.parentId) : null,
                    parent: ticket.parent,
                    subIssues: ticket.subIssues,
                    tracker: ticket.tracker,
                    blockers: ticket.blockers,
                };
            }),
        });
        board.push();
    };
    const refresh = async () => {
        items.invalidate();

        const read = await items.read();

        tickets = read.items;
        board.update({ itemSourceProblems: read.problems, error: null });
        reread();
    };
    const provider = sampleProvider(tracker, refresh);
    const adding = createCapture({
        board,
        items,
        records,
        repos,
        reread,
        provider,
        labels: tracker.labels,
        discoverOptions: (repo) =>
            discoverTicketOptions(repo, {
                ...vocabulary,
                azureOptions: async () => {
                    throw Error('Sample mode never calls Azure.');
                },
            }),
    });
    const commands = createItemCommands({
        board,
        items,
        records,
        reread,
        archive: () => [],
        offerModelChoices: () => board.snapshot().modelChoices,
        clearedFailuresFile: null,
        kindTracker: (repo) => ({ labels: tracker.labels(repo), kinds: tracker.kinds(repo) }),
    });
    const details = createItemDetails(
        null,
        (item) => tickets.find((ticket) => ticket.repo === item.repo && ticket.number === item.number),
        {
            records,
            specSync: { provider, dir },
            setupOf: (repo) => repos().find((config) => config.repo === repo)?.setup,
            labelsOf: tracker.labels,
            kindsOf: tracker.kinds,
            readDetails: async (item) => (await tracker.read(item.repo, item.number))!.details,
            readComments: async () => ({ comments: [], olderCursor: null }),
            saveTicketDescription: async (item, { body }) => {
                try {
                    await tracker.edit(item.repo, item.number, { body });
                    await refresh();

                    return null;
                } catch (error) {
                    return { status: 502, error: (error as Error).message };
                }
            },
        },
    );
    let remapped = JSON.stringify(fixture);

    for (const repo of fixture.repos)
        remapped = remapped.replaceAll(repo.repo, `lar-factory-sample/${repo.repo.split('/')[1]}`);

    board.update({
        ...sampleActivityFrom(JSON.parse(remapped) as BoardData, Date.now()),
        capture: { ...board.snapshot().capture!, enabled: true },
        firstRead: SETTLED_FIRST_READ,
    });
    await refresh();

    return {
        commands,
        capture: adding,
        itemDetails: {
            ...details,
            async details(item: Item) {
                const read = await details.details(item);
                const record = recordDetails(records, item.id);

                // Frozen local evidence needs no tracker or Spec synchronisation.
                return record?.runSettings?.length && !('error' in read) ? { ...read, record } : read;
            },
        },
        showLabelChange(item: Item, { label, action }: LabelChange) {
            tickets = tickets.map((ticket) => {
                if (ticket.repo !== item.repo || ticket.number !== item.number) return ticket;

                const labels = ticket.labels.filter((name) => !sameLabel(name, label));

                return { ...ticket, labels: action === 'add' ? [...labels, label] : labels };
            });
            reread();
        },
        showTicketType(item: Item, type: string) {
            tickets = tickets.map((ticket) =>
                ticket.repo === item.repo && ticket.number === item.number ? { ...ticket, issueType: type } : ticket,
            );
            reread();
        },
        readSoon: () => {
            void refresh().catch((error: unknown) => {
                board.update({ error: (error as Error).message });
                board.push();
            });
        },
        async changeRepositoryLabels(input: Record<string, unknown>) {
            if (!repos().some((repo) => repo.repo === input.repo))
                return { status: 403, error: 'Choose a fake sample Project.' };

            return changeRepositoryLabels(input, dir, {
                labels: tracker.labels(input.repo as string),
                capabilities: trackerCapabilities(input.repo as string),
            });
        },
        async changeRepositorySettings(input: Record<string, unknown>) {
            if (
                !repos().some((repo) => repo.repo === input.repo) ||
                !['vocabulary', 'discover-vocabulary'].includes(String(input.change))
            )
                return { status: 403, error: 'Sample mode changes only fake kind mappings.' };

            return changeRepositorySettings(
                input,
                dir,
                vocabulary,
                async (repo, name) => (await tracker.labels(repo).create({ name })).name,
            );
        },
        sampleControl: sampleControls(tracker, refresh),
        close: () => records.close(),
    };
}
