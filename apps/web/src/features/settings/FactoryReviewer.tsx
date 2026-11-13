import {
    builtinReviewerMode,
    type ReviewerDefinition,
    type ReviewerMode,
    type ReviewerTrigger,
} from '@lar-factory/shared/factory-settings';
import { Fragment } from 'react';

import { builtinReviewer } from './FactoryDraft';
import {
    FactoryActions,
    FactoryAction,
    FactoryChoice,
    FactoryText,
    FactoryReviewerRow,
    FactoryReviewerMode,
} from '@/ui/board';

const policies = [
    { value: 'security', label: 'Security changes' },
    { value: 'ui', label: 'Visible UI changes' },
    { value: 'performance', label: 'Performance-sensitive changes' },
    { value: 'rules', label: 'My path or diff rules' },
];

function TriggerEditor({
    trigger,
    onChange,
}: {
    trigger: ReviewerTrigger;
    onChange: (trigger: ReviewerTrigger) => void;
}) {
    return (
        <>
            <FactoryChoice
                label="Trigger"
                value={trigger.kind === 'policy' ? trigger.policy : 'rules'}
                options={policies}
                onChange={(next) =>
                    onChange(
                        next === 'rules'
                            ? { version: 1, kind: 'rules', any: [{ target: 'path-glob', pattern: '' }] }
                            : { version: 1, kind: 'policy', policy: next as 'security' | 'ui' | 'performance' },
                    )
                }
            />
            {trigger.kind === 'rules' && (
                <>
                    {trigger.any.map((rule, index) => (
                        <Fragment key={index}>
                            <FactoryChoice
                                label={`Rule ${index + 1} matches`}
                                value={rule.target}
                                options={[
                                    { value: 'path-glob', label: 'Changed file path' },
                                    { value: 'diff-text', label: 'Changed text' },
                                ]}
                                onChange={(target) =>
                                    onChange({
                                        ...trigger,
                                        any: trigger.any.map((entry, i) =>
                                            i === index ? { ...entry, target: target as typeof rule.target } : entry,
                                        ),
                                    })
                                }
                            />
                            <FactoryText
                                label={`Rule ${index + 1} pattern`}
                                description={
                                    rule.target === 'path-glob'
                                        ? 'For example docs/**. * matches within a folder; ** includes subfolders. Case-sensitive.'
                                        : 'Exact, case-sensitive text in changed lines, such as fetch(. No regular expressions.'
                                }
                                value={rule.pattern}
                                onChange={(pattern) =>
                                    onChange({
                                        ...trigger,
                                        any: trigger.any.map((entry, i) =>
                                            i === index ? { ...entry, pattern } : entry,
                                        ),
                                    })
                                }
                            />
                            <FactoryActions note="Any matching rule runs this reviewer.">
                                <FactoryAction
                                    disabled={trigger.any.length === 1}
                                    onClick={() =>
                                        onChange({ ...trigger, any: trigger.any.filter((_, i) => i !== index) })
                                    }
                                >
                                    Remove rule {index + 1}
                                </FactoryAction>
                            </FactoryActions>
                        </Fragment>
                    ))}
                    <FactoryActions>
                        <FactoryAction
                            onClick={() =>
                                onChange({ ...trigger, any: [...trigger.any, { target: 'path-glob', pattern: '' }] })
                            }
                        >
                            Add rule
                        </FactoryAction>
                    </FactoryActions>
                </>
            )}
        </>
    );
}

export function FactoryReviewer({
    reviewer,
    editing,
    onEdit,
    text,
    onChange,
    onText,
    onDuplicate,
    onRemove,
}: {
    reviewer: ReviewerDefinition;
    editing: boolean;
    onEdit: () => void;
    text: string;
    onChange: (reviewer: ReviewerDefinition) => void;
    onText: (text: string) => void;
    onDuplicate: () => void;
    onRemove: () => void;
}) {
    const mode = reviewer.mode;
    const builtin = builtinReviewer(reviewer.id);

    return (
        <FactoryReviewerRow
            name={reviewer.name}
            packaged={builtin}
            editing={editing}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
            instructions={text}
            mode={
                <FactoryReviewerMode
                    label={`${reviewer.name} review mode`}
                    value={mode.kind}
                    options={[
                        { value: 'always', label: 'Always' },
                        { value: 'on-trigger', label: 'On trigger' },
                        { value: 'never', label: 'Never' },
                    ]}
                    onChange={(kind) => {
                        const next: ReviewerMode = builtinReviewer(reviewer.id)
                            ? builtinReviewerMode(reviewer.id, kind as ReviewerMode['kind'])
                            : kind === 'on-trigger'
                              ? {
                                    kind,
                                    trigger:
                                        reviewer.trigger ??
                                        (mode.kind === 'on-trigger'
                                            ? mode.trigger
                                            : {
                                                  version: 1,
                                                  kind: 'rules',
                                                  any: [{ target: 'path-glob', pattern: '' }],
                                              }),
                                }
                              : { kind: kind as 'always' | 'never' };

                        onChange({
                            ...reviewer,
                            mode: next,
                            ...(!builtin && mode.kind === 'on-trigger' ? { trigger: mode.trigger } : {}),
                        } as ReviewerDefinition);
                    }}
                />
            }
        >
            {!builtin && editing && (
                <>
                    <FactoryText
                        label="Reviewer name"
                        autoFocus
                        value={reviewer.name}
                        onChange={(name) => onChange({ ...reviewer, name })}
                    />
                    {!builtin && mode.kind === 'on-trigger' && (
                        <TriggerEditor
                            trigger={mode.trigger}
                            onChange={(trigger) =>
                                onChange({
                                    ...reviewer,
                                    trigger,
                                    mode: { kind: 'on-trigger', trigger },
                                } as ReviewerDefinition)
                            }
                        />
                    )}
                    <FactoryText
                        label="Instructions"
                        multiline
                        value={text}
                        onChange={onText}
                        description="Edits save as a new revision. Existing runs keep their saved instructions."
                    />
                </>
            )}
        </FactoryReviewerRow>
    );
}
