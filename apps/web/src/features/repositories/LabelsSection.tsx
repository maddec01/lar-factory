import { trackerCapabilities, writeAccessProblem, type RepositorySetup } from '@lar-factory/shared';
import { Alert, Button, buttonKind, FormSection, Text, TrackerLabelList } from '@lar-works/design-system';
// Settings' Labels section. The tracker holds the only copy, so the section reads it each time and keeps no list. It reads
// the capability description for what the tracker's labels have, and never checks a provider's name.
import { useState } from 'react';

import { AccessReason } from './AccessList';
import { CreateLabel } from './CreateLabel';
import { DeleteConfirm } from './DeleteLabelConfirm';
import { useEditStore, type LabelChange } from './EditStore';
import { LabelRow } from './LabelRow';
import { useTrackerLabels } from './useTrackerLabels';
import { KIND_NAMES, type VocabularyKind } from './VocabularyKinds';

/** The kind mappings holding `name` in this repository, as a sentence names them, or null when none does. */
function mappingsOf(name: string, setup: RepositorySetup): string | null {
    const kinds = (Object.keys(KIND_NAMES) as VocabularyKind[])
        .filter((key) => setup.vocabulary[key].labels.some((label) => label.toLowerCase() === name.toLowerCase()))
        .map((key) => KIND_NAMES[key]);

    return kinds.length ? `the ${new Intl.ListFormat('en').format(kinds)} mapping${kinds.length > 1 ? 's' : ''}` : null;
}

/** Lists the tracker's labels with create, rename and delete in place; read-only with the reason when the access check rules them out. */
export function LabelsSection({ repo, setup }: { repo: string; setup: RepositorySetup }) {
    const capabilities = trackerCapabilities(repo);
    const { heading, changeScope, createUnavailable } = capabilities;
    const { labels, error, retry } = useTrackerLabels(repo);
    const [editing, setEditing] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<string | null>(null);
    const readOnly = writeAccessProblem(repo, 'manage-labels', setup.access, { azureReadOnly: setup.azureReadOnly });

    /** Sends one change, and reads the tracker again once it lands. The reason it failed, or null. */
    const change = async (body: LabelChange) => {
        const failed = await useEditStore.getState().labels(repo, body);

        if (!failed) retry();

        return failed;
    };

    return (
        <FormSection
            presentation="dense"
            data-labels
            title={heading}
            description={
                <>
                    Changes here write to the tracker straight away, for everyone using{' '}
                    {changeScope === 'project' ? 'the whole project' : 'the repository'}.
                </>
            }
        >
            {readOnly && (
                <AccessReason
                    repo={repo}
                    reason={readOnly}
                    onRecheck={() => {
                        void useEditStore.getState().recheck(repo);
                    }}
                />
            )}
            {error ? (
                <Alert
                    tone="danger"
                    title={`Could not read ${heading.toLowerCase()}`}
                    action={
                        <Button {...buttonKind('other')} onClick={retry}>
                            Retry
                        </Button>
                    }
                >
                    {error}
                </Alert>
            ) : !labels ? (
                <Text tone="muted" role="status">
                    Reading {heading.toLowerCase()}…
                </Text>
            ) : (
                <>
                    <CreateLabel
                        capabilities={capabilities}
                        cannotCreate={readOnly ?? createUnavailable}
                        showUnavailable={!readOnly && !!createUnavailable}
                        onCreate={(name) => change({ change: 'create', name })}
                    />
                    {labels.length ? (
                        <TrackerLabelList>
                            {labels.map((label) => (
                                <LabelRow
                                    key={label.name}
                                    label={label}
                                    capabilities={capabilities}
                                    mappings={mappingsOf(label.name, setup)}
                                    readOnly={readOnly}
                                    editing={editing === label.name}
                                    onEdit={(open) => setEditing(open ? label.name : null)}
                                    onDelete={() => setDeleting(label.name)}
                                    onSave={change}
                                />
                            ))}
                        </TrackerLabelList>
                    ) : (
                        <Text variant="caption" tone="muted">
                            No {heading.toLowerCase()} yet.
                        </Text>
                    )}
                </>
            )}
            {deleting && (
                <DeleteConfirm
                    name={deleting}
                    capabilities={capabilities}
                    mappings={mappingsOf(deleting, setup)}
                    onDelete={() => change({ change: 'delete', name: deleting })}
                    onClose={() => setDeleting(null)}
                />
            )}
        </FormSection>
    );
}
