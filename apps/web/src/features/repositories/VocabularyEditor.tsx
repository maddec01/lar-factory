import { trackerCapabilities, type VocabularyTerm } from '@lar-factory/shared';
import type { VocabularyDiscovery } from '@lar-factory/shared/vocabulary';
import { Alert, Badge, Button, buttonKind, FormSelect } from '@lar-works/design-system';

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
        <p role="status" className="text-base-700 m-0 text-sm">
            Reading existing {trackerCapabilities(repo).heading.toLowerCase()} and types…
        </p>
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
        <div data-vocabulary={name} className="grid min-w-0 gap-2 px-3 py-3">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[5.5rem_8.5rem_minmax(0,1fr)]">
                <span className="text-[13px] font-medium">{title}</span>
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
                <div
                    role="group"
                    aria-label={`${title} ${plural}`}
                    className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 sm:col-span-1"
                >
                    {chosen.slice(0, 2).map((label) => (
                        <Badge key={label} className="max-w-40 min-w-0">
                            <span className="inline-flex min-w-0 items-center gap-1">
                                <span className="truncate" title={label}>
                                    {label}
                                    {newLabels.includes(label) ? ' (new)' : gone(label) ? ' (unavailable)' : ''}
                                </span>
                                <button
                                    type="button"
                                    className="cursor-pointer bg-transparent p-0"
                                    aria-label={`Remove ${label} from ${title}`}
                                    disabled={disabled}
                                    onClick={() => toggle(label)}
                                >
                                    ×
                                </button>
                            </span>
                        </Badge>
                    ))}
                    {chosen.length > 2 && (
                        <button
                            type="button"
                            className="cursor-pointer rounded-full bg-(--muted) px-2 text-xs"
                            aria-label={`${chosen.length - 2} more ${title} ${plural}`}
                            onClick={() => close(true)}
                        >
                            +{chosen.length - 2}
                        </button>
                    )}
                    {!chosen.length && !suggested && <span className="text-xs text-(--muted-foreground)">None</span>}
                    {suggested && (
                        <button
                            type="button"
                            disabled={disabled}
                            className="cursor-pointer rounded-full border border-dashed border-(--border) px-2 py-0.5 text-xs"
                            onClick={() => update({ ...value, labels: [suggested] })}
                        >
                            + {suggested} · suggested
                        </button>
                    )}
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
                </div>
            </div>
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
                <span className="text-xs text-(--muted-foreground)">
                    This Project has no {discovery.provider === 'azure' ? 'work item' : 'issue'} types.
                </span>
            )}
            {value.type && (typesProblem || !types.includes(value.type)) && (
                <span className="text-xs">
                    <Button
                        {...buttonKind('other')}
                        className="h-auto min-h-8 max-w-full py-1 text-left wrap-anywhere whitespace-normal"
                        onClick={() => update({ ...value, type: null }, newLabels, true)}
                    >
                        Remove {value.type}
                    </Button>
                </span>
            )}
            {error && (
                <p role="alert" className="m-0 text-xs text-(--error-foreground)">
                    {error}{' '}
                    <button type="button" className="cursor-pointer bg-transparent p-0 underline" onClick={retryCommit}>
                        Retry
                    </button>
                </p>
            )}
        </div>
    );
}
