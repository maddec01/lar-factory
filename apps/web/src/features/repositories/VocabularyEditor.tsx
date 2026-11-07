import { trackerCapabilities, type VocabularyTerm } from '@lar-factory/shared';
import type { VocabularyDiscovery } from '@lar-factory/shared/vocabulary';
import {
    Alert,
    Button,
    buttonKind,
    ButtonRow,
    FormSelect,
    InlineLink,
    Text,
    VocabularyChip,
    VocabularyMore,
    VocabularyRow,
    VocabularySuggestion,
} from '@lar-works/design-system';

import { AccessReason } from './AccessList';
import { useVocabularyFields } from './useVocabularyFields';
import type { VocabularyAccess, VocabularyKind } from './VocabularyKinds';
import { VocabularyLabelPopover } from './VocabularyLabelPopover';

export function VocabularyRead({ repo, error, retry }: { repo: string; error: string | null; retry: () => void }) {
    return error ? (
        <Alert
            tone="danger"
            title="Could not read vocabulary"
            action={
                <Button {...buttonKind('other')} onClick={retry}>
                    Retry
                </Button>
            }
        >
            {error}
        </Alert>
    ) : (
        <Text tone="muted" role="status">
            Reading existing {trackerCapabilities(repo).heading.toLowerCase()} and types…
        </Text>
    );
}

/** Without onCommit this edits onboarding drafts only. A Project commits one complete kind on close or Create. */
export function VocabularyFields({
    name,
    setup,
    discovery,
    value,
    newLabels,
    disabled = false,
    onChange,
    onCommit,
    onRecheck,
    error,
}: {
    name: VocabularyKind;
    setup: VocabularyAccess;
    discovery: VocabularyDiscovery;
    value: VocabularyTerm;
    newLabels: string[];
    disabled?: boolean;
    onChange: (value: VocabularyTerm, newLabels: string[]) => void;
    onCommit?: ((value: VocabularyTerm, newLabels: string[]) => void) | undefined;
    onRecheck?: (() => void) | undefined;
    error?: string | undefined;
}) {
    const fields = useVocabularyFields({ name, setup, discovery, value, newLabels, onChange, onCommit });
    const {
        retryCommit,
        access,
        labelsProblem,
        typesProblem,
        plural,
        types,
        title,
        chosen,
        suggested,
        update,
        toggle,
        close,
        gone,
    } = fields;

    return (
        <VocabularyRow
            data-vocabulary={name}
            title={title}
            type={
                <FormSelect
                    aria-label={`${title} type`}
                    writesOnPick
                    value={value.type ?? ''}
                    none="No type"
                    disabled={disabled || (!types.length && !value.type)}
                    onChange={(type) => update({ ...value, type: type || null }, newLabels, true)}
                    choices={[
                        ...(value.type && !types.includes(value.type)
                            ? [{ value: value.type, name: `${value.type} (unavailable)`, disabled: true }]
                            : []),
                        ...types.map((type) => ({ value: type, name: type, disabled: !!typesProblem })),
                    ]}
                />
            }
            labelsLabel={`${title} ${plural}`}
            labels={
                <>
                    {chosen.slice(0, 2).map((label) => (
                        <VocabularyChip
                            key={label}
                            label={label}
                            removeLabel={`Remove ${label} from ${title}`}
                            disabled={disabled}
                            onRemove={() => toggle(label)}
                        >
                            {label}
                            {newLabels.includes(label) ? ' (new)' : gone(label) ? ' (unavailable)' : ''}
                        </VocabularyChip>
                    ))}
                    {chosen.length > 2 && (
                        <VocabularyMore
                            label={`${chosen.length - 2} more ${title} ${plural}`}
                            onClick={() => close(true)}
                        >
                            {`+${chosen.length - 2}`}
                        </VocabularyMore>
                    )}
                    {!chosen.length && !suggested && (
                        <Text variant="caption" tone="muted">
                            None
                        </Text>
                    )}
                    {suggested && (
                        <VocabularySuggestion
                            disabled={disabled}
                            onClick={() => update({ ...value, labels: [suggested] })}
                        >
                            + {suggested} · suggested
                        </VocabularySuggestion>
                    )}
                </>
            }
            chooser={
                <VocabularyLabelPopover
                    name={name}
                    repo={setup.repo}
                    value={value}
                    newLabels={newLabels}
                    disabled={disabled}
                    onCommit={onCommit}
                    onRecheck={onRecheck}
                    fields={fields}
                />
            }
        >
            {labelsProblem && <AccessReason repo={setup.repo} reason={labelsProblem} onRecheck={onRecheck} />}
            {newLabels.length > 0 && access.newLabels && (
                <AccessReason repo={setup.repo} reason={access.newLabels} onRecheck={onRecheck} />
            )}
            {typesProblem && (
                <AccessReason
                    repo={setup.repo}
                    reason={typesProblem}
                    onRecheck={discovery.types.state === 'unsupported' ? undefined : onRecheck}
                />
            )}
            {!types.length && !typesProblem && (
                <Text variant="caption" tone="muted">
                    This Project has no {discovery.provider === 'azure' ? 'work item' : 'issue'} types.
                </Text>
            )}
            {value.type && (typesProblem || !types.includes(value.type)) && (
                <ButtonRow>
                    <Button
                        {...buttonKind('other')}
                        wrap
                        onClick={() => update({ ...value, type: null }, newLabels, true)}
                    >
                        Remove {value.type}
                    </Button>
                </ButtonRow>
            )}
            {error && (
                <Text variant="caption" tone="danger" role="alert">
                    {error} <InlineLink onClick={retryCommit}>Retry</InlineLink>
                </Text>
            )}
        </VocabularyRow>
    );
}
