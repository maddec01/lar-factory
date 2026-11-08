// The Project page's setting links, named with the repository's tracker vocabulary.

import { onAzure, trackerCapabilities } from '@lar-factory/shared';

const PROJECT_SETTINGS = [
    { id: 'role', label: 'What this project does' },
    { id: 'itemSource', label: 'Work to read' },
    { id: 'createIssuesFromAddItem', label: 'Create issues from Add item' },
    { id: 'createIssuesFromRetro', label: 'Create issues from retro captures' },
    { id: 'writeRefinedSpec', label: 'Write the refined spec to the issue' },
    { id: 'vocabulary', label: 'Kinds and labels' },
    { id: 'labels', label: 'Labels' },
    { id: 'domainDocs', label: 'Glossary and decisions' },
    { id: 'glossary', label: 'Glossary path' },
    { id: 'adrs', label: 'ADR folder' },
    { id: 'skills', label: 'Project skills' },
    { id: 'access', label: 'Access' },
];

export function projectSettings(repo: string) {
    return PROJECT_SETTINGS.map((setting) => ({
        ...setting,
        label:
            setting.id === 'itemSource' && onAzure(repo)
                ? 'Team'
                : setting.id === 'labels'
                  ? trackerCapabilities(repo).heading
                  : setting.id === 'vocabulary'
                    ? `Kinds and ${trackerCapabilities(repo).heading.toLowerCase()}`
                    : setting.label,
    }));
}
