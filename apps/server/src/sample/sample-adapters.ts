import { trackerKind, type RepoConfig } from '@lar-factory/shared';
import type { VocabularyReads } from '@lar-factory/shared/publication-settings';
import { readRepositorySetups, saveLocalSetup, saveOnboarded } from '@lar-factory/shared/repository-settings';
import type { StructureProvider, StructureTicket } from '@lar-factory/work-records/tracker-sync';

import type { FakeIssue } from './fake-tracker-state.ts';
import type { createFakeTracker } from './fake-tracker.ts';

type Tracker = ReturnType<typeof createFakeTracker>;

/** Seed only the disposable sample settings, through the same settings writer as onboarding. */
export function sampleRepositories(tracker: Tracker, dir: string): () => RepoConfig[] {
    const seed = tracker.repositories();

    for (const config of seed) {
        saveOnboarded(config.repo, null, dir);
        saveLocalSetup(
            config.repo,
            {
                projectId: `sample-${config.repo.split('/')[1]}`,
                role: config.role,
                itemSource: { kind: 'issues' },
                domainDocs: { kind: 'off' },
                skills: [],
                structureSync: false,
                vocabulary: config.setup?.vocabulary,
            },
            {
                'publish-ticket': 'allowed',
                'edit-ticket': 'allowed',
                'tag-ticket': 'allowed',
                'manage-labels': 'allowed',
                'type-ticket': 'allowed',
                'relate-ticket': 'allowed',
            },
            dir,
        );
    }

    return () => {
        const setups = readRepositorySetups(dir);

        return seed.map((config) => ({ ...config, setup: setups.find((setup) => setup.repo === config.repo)! }));
    };
}

/** Metadata discovery still uses its production parser; these reads cannot leave the fake allowlist. */
export function sampleVocabulary(tracker: Tracker): VocabularyReads {
    return {
        async github(path) {
            const match = /^repos\/(lar-factory-sample\/[^/?]+)(.*)$/.exec(path);

            if (!match) throw Error('Sample metadata only accepts fake repositories.');

            const labels = tracker.labels(match[1]!);

            if (match[2] === '') return { owner: { type: 'User' } };

            if (match[2] === '/labels?per_page=100') return labels.list();

            if (['/assignees?per_page=100', '/milestones?state=open&per_page=100'].includes(match[2]!)) return [];

            throw Error('This metadata is unavailable in sample mode.');
        },
        async azure() {
            throw Error('Sample mode never calls Azure.');
        },
    };
}

const snapshot = ({ item, details }: FakeIssue): StructureTicket => ({
    repository: item.repo,
    number: item.number,
    title: item.title,
    body: details.body,
    version: String(item.revision),
    kind: item.kind,
});

/** Creation and description reads share the real capture contract, including its durable request identity. */
export function sampleProvider(tracker: Tracker, changed: () => Promise<void>): StructureProvider {
    return {
        async readSpec(repo, number) {
            const issue = await tracker.read(repo, number);

            if (!issue) throw Error('Sample issue not found.');

            return { ...snapshot(issue), editorWrite: true, titleEditorWrite: true };
        },
        async replaceSpec(ticket, body) {
            const before = await tracker.read(ticket.repository, ticket.number);

            if (!before || String(before.item.revision) !== ticket.version)
                throw Error('The sample Spec changed before writing.');

            await tracker.edit(ticket.repository, ticket.number, { body });

            const after = await tracker.read(ticket.repository, ticket.number);

            await changed();

            return { ...snapshot(after!), editorWrite: true, titleEditorWrite: true };
        },
        async read(repo, number) {
            const issue = await tracker.read(repo, number);

            if (!issue) throw Error('Sample issue not found.');

            return snapshot(issue);
        },
        async find(repo, identity) {
            const found: StructureTicket[] = [];

            for (const item of await tracker.list(repo)) {
                const issue = await tracker.read(repo, item.number);

                if (issue?.details.body.includes(`"identity":"${identity}"`)) found.push(snapshot(issue));
            }

            return found;
        },
        async create(repo, title, body, type, _areaPath, options) {
            const identity = /<!-- lar-factory:create \{"identity":"([a-f0-9-]+)"\} -->/.exec(body)?.[1];

            if (!identity) throw Error('Sample creation needs its request identity.');

            const issue = await tracker.create(repo, {
                identity,
                title,
                body,
                kind: trackerKind(options?.labels ?? [], type),
                labels: options?.labels,
                type,
            });

            await changed();

            return snapshot(issue);
        },
        async replace(ticket, body) {
            await tracker.edit(ticket.repository, ticket.number, { body });
            await changed();
        },
        async comment() {
            throw Error('Sample mode publishes no structural comments.');
        },
        async readComment() {
            throw Error('Sample mode reads no provider comments.');
        },
    };
}
