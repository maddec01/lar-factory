import { sameLabel, trackerKind, type TicketKinds, type TrackerLabel, type TrackerLabels } from '@lar-factory/shared';

import type { fakeFailures } from './fake-failures.ts';
import { fakeIssue, type FakeRepository } from './fake-tracker-state.ts';

export function fakeTrackerLabels(
    repository: () => FakeRepository,
    failures: ReturnType<typeof fakeFailures>,
): TrackerLabels {
    const run = <Input, Result>(
        operation: Parameters<typeof failures.run>[0],
        input: Input,
        action: (repo: FakeRepository, sent: Input) => Result,
    ) => {
        repository();

        const sent = structuredClone(input);

        return failures.run(operation, () => action(repository(), sent));
    };
    const labelAt = (repo: FakeRepository, name: string) => {
        const at = repo.labels.findIndex((label) => sameLabel(label.name, name));

        if (at < 0) throw new Error(`Sample label ${name} does not exist.`);

        return at;
    };
    const validate = (label: TrackerLabel) => {
        if (!label.name.trim() || label.name.length > 256) throw new Error('Enter a sample label name.');

        if (label.color !== undefined && !/^[0-9a-f]{6}$/i.test(label.color))
            throw new Error('Use six hex digits for the colour.');
    };
    const refresh = (repo: FakeRepository) => {
        for (const issue of repo.issues.values()) {
            issue.item.labelColors = Object.fromEntries(
                repo.labels
                    .filter((label) => label.color && issue.item.labels.includes(label.name))
                    .map((label) => [label.name, `#${label.color}`]),
            );
            issue.item.kind = trackerKind(issue.item.labels, issue.type);
        }
    };

    return {
        list: () => run('labels.list', null, (repo) => repo.labels),
        create: (label) =>
            run('labels.create', label, (repo, label) => {
                validate(label);

                const existing = repo.labels.find((other) => sameLabel(other.name, label.name));

                if (existing) return existing;

                const created = { color: 'ededed', ...label };

                repo.labels.push(created);

                return created;
            }),
        update: (name, change) =>
            run('labels.update', change, (repo, change) => {
                const at = labelAt(repo, name);
                const updated = { ...repo.labels[at]!, ...change };

                validate(updated);

                if (repo.labels.some((label, index) => index !== at && sameLabel(label.name, updated.name)))
                    throw new Error('That sample label already exists.');

                repo.labels[at] = updated;

                for (const { item } of repo.issues.values())
                    item.labels = item.labels.map((label) => (sameLabel(label, name) ? updated.name : label));

                refresh(repo);

                return updated;
            }),
        delete: (name) =>
            run('labels.delete', null, (repo) => {
                repo.labels.splice(labelAt(repo, name), 1);

                for (const { item } of repo.issues.values())
                    item.labels = item.labels.filter((label) => !sameLabel(label, name));

                refresh(repo);
            }),
        addToTicket: (number, names) =>
            run('labels.addToTicket', names, (repo, names) => {
                const issue = fakeIssue(repo, number);
                const labels = names.map((name) => repo.labels[labelAt(repo, name)]!.name);

                issue.item.labels = [...new Set([...issue.item.labels, ...labels])];
                refresh(repo);
            }),
        removeFromTicket: (number, names) =>
            run('labels.removeFromTicket', names, (repo, names) => {
                const issue = fakeIssue(repo, number);

                issue.item.labels = issue.item.labels.filter((label) => !names.some((name) => sameLabel(label, name)));
                refresh(repo);
            }),
    };
}

export function fakeTicketKinds(
    repository: () => FakeRepository,
    failures: ReturnType<typeof fakeFailures>,
): TicketKinds {
    const run = <T>(operation: Parameters<typeof failures.run>[0], action: (repo: FakeRepository) => T) => {
        repository();

        return failures.run(operation, () => action(repository()));
    };

    return {
        read: (number) =>
            run('kinds.read', (repo) => {
                const issue = fakeIssue(repo, number);

                return { labels: issue.item.labels, type: issue.type };
            }),
        setType: (number, type) =>
            run('kinds.setType', (repo) => {
                if (!type.trim() || type.length > 256) throw new Error('Choose a sample issue type.');

                const issue = fakeIssue(repo, number);

                issue.type = type;
                issue.item.issueType = type;
                issue.item.kind = trackerKind(issue.item.labels, type);
            }),
        boardTypes: () => run('kinds.boardTypes', () => null),
    };
}
