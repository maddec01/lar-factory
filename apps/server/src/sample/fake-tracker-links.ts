import { writeTrackerStructure, type IssueRef, type TrackerPart } from '@lar-factory/shared';

import { fakeIssue, fakeRepository, type FakeIssue, type FakeRepository } from './fake-tracker-state.ts';

export interface FakeReference {
    repo: string;
    number: number;
}

export function fakeTrackerLinks(repositories: () => Map<string, FakeRepository>) {
    const get = (ref: FakeReference) => fakeIssue(fakeRepository(repositories(), ref.repo), ref.number);
    const all = () => [...repositories().values()].flatMap((repository) => [...repository.issues.values()]);
    const reference = ({ item }: FakeIssue): IssueRef => ({
        repo: item.repo,
        number: item.number,
        title: item.title,
        url: item.url!,
        state: item.state,
    });
    const part = (issue: FakeIssue): TrackerPart => ({
        url: issue.item.url!,
        title: issue.item.title,
        kind: issue.item.kind,
        repository: issue.item.repo,
    });

    return {
        get,
        parent(child: FakeReference, parent: FakeReference | null) {
            const issue = get(child);
            const target = parent ? get(parent) : null;
            let ancestor = target;

            while (ancestor) {
                if (ancestor === issue) throw new Error('Sample parent links cannot form a cycle.');

                const id = ancestor.item.parentId;

                ancestor = all().find((candidate) => candidate.item.id === id) ?? null;
            }

            issue.item.parentId = target?.item.id ?? null;
        },
        link(from: FakeReference, to: FakeReference, kind: 'related' | 'blocked-by', present: boolean) {
            const issue = get(from);
            const target = get(to);

            if (issue === target) throw new Error('A sample issue cannot link to itself.');

            const existing = kind === 'related' ? (issue.details.related ?? []) : issue.item.blockers;
            const kept = existing.filter((other) => other.repo !== to.repo || other.number !== to.number);

            if (present) kept.push(reference(target));

            if (kind === 'related') issue.details.related = kept as IssueRef[];
            else issue.item.blockers = kept;
        },
        project(issue: FakeIssue): FakeIssue {
            const projected = structuredClone(issue);
            const { item, details } = projected;
            const parent = all().find((candidate) => candidate.item.id === item.parentId);
            const children = all().filter((candidate) => candidate.item.parentId === item.id);
            const blockers = item.blockers.map(get);
            const related = (details.related ?? []).map(get);

            item.parent = parent ? reference(parent) : null;
            item.subIssues = {
                total: children.length,
                completed: children.filter((child) => child.item.state === 'closed').length,
            };
            item.blockers = blockers.map(reference);
            item.labelColors = Object.fromEntries(
                fakeRepository(repositories(), item.repo)
                    .labels.filter((label) => label.color && item.labels.includes(label.name))
                    .map((label) => [label.name, `#${label.color}`]),
            );
            details.subTickets = children.map(reference);
            details.related = related.map(reference);
            details.blockers = blockers.map(reference);
            item.tracker = {
                version: 1,
                kind: item.kind,
                repository: item.repo,
                ...(parent && { parent: part(parent) }),
                parts: children.map(part),
                blockers: blockers.map(part),
                connections: related.map(part),
            };
            details.body = writeTrackerStructure(details.body, item.tracker);

            return projected;
        },
    };
}
