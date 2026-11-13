import { parseConceptMap, stripTrackerStructure, trackerKind, type RepoConfig } from '@lar-factory/shared';

import { fakeFailures } from './fake-failures.ts';
import { fakeTicketKinds, fakeTrackerLabels } from './fake-tracker-labels.ts';
import { fakeTrackerLinks, type FakeReference } from './fake-tracker-links.ts';
import { seedFakeTracker } from './fake-tracker-seed.ts';
import {
    FAKE_TIME,
    fakeRepository,
    newFakeIssue,
    type FakeIssueDraft,
    type FakeIssueEdit,
} from './fake-tracker-state.ts';

/** Local sample composition only. This module has no provider, T3, settings, database or data-folder dependency. */
export function createFakeTracker({ mode }: { mode: 'sample' }) {
    if (mode !== 'sample') throw new Error('The fake tracker is available only in local sample mode.');

    let repositories = seedFakeTracker();
    const failures = fakeFailures();
    const links = fakeTrackerLinks(() => repositories);
    const repository = (repo: string) => fakeRepository(repositories, repo);
    const run = <T>(repo: string, operation: Parameters<typeof failures.run>[0], action: () => T) => {
        repository(repo);

        return failures.run(operation, action);
    };
    const validate = ({ title, body, kind }: Omit<FakeIssueDraft, 'identity'>) => {
        if (!title.trim() || title.length > 256 || /[\r\n]/.test(title))
            throw new Error('Enter a sample issue title of at most 256 characters.');

        if (body.length > 262_144) throw new Error('The sample body is too long.');

        if (!['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'issue'].includes(kind))
            throw new Error('Choose a sample issue kind.');
    };

    return {
        /** Snapshot for F02's ephemeral settings and board composition. No real fixture repository is accepted. */
        repositories: (): RepoConfig[] => structuredClone([...repositories.values()].map(({ config }) => config)),
        labels: (repo: string) => {
            repository(repo);

            return fakeTrackerLabels(() => repository(repo), failures);
        },
        kinds: (repo: string) => {
            repository(repo);

            return fakeTicketKinds(() => repository(repo), failures);
        },
        list: (repo: string) =>
            run(repo, 'issues.list', () =>
                [...repository(repo).issues.values()].map((issue) => links.project(issue).item),
            ),
        read: (repo: string, number: number) =>
            run(repo, 'issues.read', () => {
                const issue = repository(repo).issues.get(number);

                return issue ? links.project(issue) : null;
            }),
        search: (repo: string, query: string) =>
            run(repo, 'issues.search', () => {
                const number = /^#?\d+$/.test(query.trim()) ? Number(query.trim().replace('#', '')) : null;
                const words = query.trim().toLowerCase().split(/\s+/);

                return [...repository(repo).issues.values()]
                    .filter(
                        ({ item }) =>
                            item.state === 'open' &&
                            (number === null
                                ? words.every((word) => item.title.toLowerCase().includes(word))
                                : item.number === number),
                    )
                    .slice(0, 20)
                    .map(({ item: { number, title, url } }) => ({ number, title, url: url! }));
            }),
        create: (repo: string, draft: FakeIssueDraft) => {
            // Copy before latency: a caller retaining its draft cannot change an in-flight request.
            const sent = structuredClone(draft);

            return run(repo, 'issues.create', () => {
                validate(sent);

                if (!sent.identity?.trim() || sent.identity.length > 256)
                    throw new Error('Send a stable sample creation identity.');

                const target = repository(repo);
                const labels = [...new Set(sent.labels ?? (sent.kind === 'issue' ? [] : [sent.kind]))];

                if (
                    labels.length > 100 ||
                    labels.some((name) => typeof name !== 'string' || !name.trim() || name.length > 256)
                )
                    throw new Error('Choose valid sample labels.');

                if (
                    sent.type !== undefined &&
                    sent.type !== null &&
                    (typeof sent.type !== 'string' || !sent.type.trim() || sent.type.length > 256)
                )
                    throw new Error('Choose a sample issue type.');

                const request = JSON.stringify({
                    title: sent.title,
                    body: sent.body,
                    kind: sent.kind,
                    labels: [...labels].sort(),
                    type: sent.type ?? null,
                });
                const existing = target.creates.get(sent.identity);

                if (existing) {
                    if (existing.request !== request)
                        throw new Error('That sample creation identity already belongs to another draft.');

                    return links.project(links.get({ repo, number: existing.number }));
                }

                const issue = newFakeIssue(repo, target.nextNumber, { ...sent, labels });

                for (const name of labels) {
                    if (!target.labels.some((label) => label.name.toLowerCase() === name.toLowerCase()))
                        target.labels.push({ name, color: 'ededed' });
                }

                target.issues.set(target.nextNumber, issue);
                target.creates.set(sent.identity, { request, number: target.nextNumber++ });

                return links.project(issue);
            });
        },
        edit: (repo: string, number: number, edit: FakeIssueEdit) => {
            const sent = structuredClone(edit);

            return run(repo, 'issues.edit', () => {
                const issue = links.get({ repo, number });

                validate({
                    title: sent.title ?? issue.item.title,
                    body: sent.body ?? issue.details.body,
                    kind: sent.kind ?? issue.item.kind,
                });

                if (sent.state !== undefined && !['open', 'closed'].includes(sent.state))
                    throw new Error('Choose an open or closed sample state.');

                if (
                    sent.closedAs !== undefined &&
                    sent.closedAs !== null &&
                    !['done', 'not-planned'].includes(sent.closedAs)
                )
                    throw new Error('Choose a sample close reason.');

                if (sent.body !== undefined) issue.details.body = stripTrackerStructure(sent.body);

                // Whitelist fields even for callers outside TypeScript; repository identity is immutable.
                for (const key of ['title', 'kind', 'state', 'closedAs', 'map'] as const) {
                    if (sent[key] !== undefined) Object.assign(issue.item, { [key]: sent[key] });
                }

                issue.item.revision++;
                issue.item.updatedAt = new Date(Date.parse(FAKE_TIME) + issue.item.revision).toISOString();
                issue.item.closedAt = issue.item.state === 'closed' ? issue.item.updatedAt : null;
                issue.item.closedAs = issue.item.state === 'open' ? null : (issue.item.closedAs ?? 'done');

                if (sent.kind) {
                    issue.type = null;
                    delete issue.item.issueType;
                    issue.item.labels = issue.item.labels.filter((label) => trackerKind([label]) === 'issue');

                    if (sent.kind !== 'issue') {
                        issue.item.labels.push(sent.kind);

                        const target = repository(repo);

                        if (!target.labels.some((label) => label.name === sent.kind))
                            target.labels.push({ name: sent.kind, color: 'ededed' });
                    }
                }

                if (
                    issue.item.kind === 'concept' &&
                    sent.map === undefined &&
                    (sent.body !== undefined || sent.kind !== undefined)
                )
                    issue.item.map = parseConceptMap(issue.details.body);

                return links.project(issue);
            });
        },
        setParent: (child: FakeReference, parent: FakeReference | null) => {
            const sentChild = structuredClone(child);
            const sentParent = structuredClone(parent);

            links.get(sentChild);

            if (sentParent) links.get(sentParent);

            return run(sentChild.repo, 'links.parent', () => links.parent(sentChild, sentParent));
        },
        setLink: (from: FakeReference, to: FakeReference, kind: 'related' | 'blocked-by', present = true) => {
            const sentFrom = structuredClone(from);
            const sentTo = structuredClone(to);

            links.get(sentFrom);
            links.get(sentTo);

            if (!['related', 'blocked-by'].includes(kind)) throw new Error('Choose a sample link kind.');

            return run(sentFrom.repo, `links.${kind}`, () => links.link(sentFrom, sentTo, kind, present));
        },
        /** F02 may expose these through local sample controls only, never normal/live server routes. */
        failures: { set: failures.set, clear: failures.clear },
        reset() {
            failures.clear();
            repositories = seedFakeTracker();
        },
    };
}
