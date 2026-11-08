// A repository's access operations as named rows and explanations, using its tracker's words for issues and labels.

import {
    onAzure,
    REPOSITORY_OPERATIONS,
    trackerCapabilities,
    type RepositoryOperation,
    type RepositorySetup,
} from '@lar-factory/shared';

import type { AccessRow } from './AccessList';

export function operationNames(repo: string): Record<RepositoryOperation, string> {
    const azure = onAzure(repo);
    const labels = trackerCapabilities(repo).heading.toLowerCase();

    return {
        'push-branch': 'Push branches',
        'open-pr': 'Open PRs',
        'edit-ticket': azure ? 'Edit work items' : 'Edit issues',
        'publish-ticket': azure ? 'Create work items' : 'Create issues',
        'tag-ticket': `Set ${labels}`,
        'manage-labels': `Manage ${labels}`,
        'comment-ticket': 'Post comments',
        'type-ticket': azure ? 'Set work item types' : 'Set issue types',
        'relate-ticket': 'Set relationships',
    };
}

export const accessRows = (setup: Pick<RepositorySetup, 'repo' | 'access'>): AccessRow[] =>
    REPOSITORY_OPERATIONS.map((operation) => ({
        name: operationNames(setup.repo)[operation],
        access: setup.access[operation],
        operation,
    }));

export function accessExplanation(repo: string, reason: string): string {
    const names = operationNames(repo);

    return REPOSITORY_OPERATIONS.reduce((text, operation) => text.replaceAll(operation, names[operation]), reason);
}
