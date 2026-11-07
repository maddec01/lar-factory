import { effectiveIssueSettings } from '@lar-factory/shared';

import { Switch } from '../settings/controls.tsx';
import { FIELD_GROUP, FieldRow } from '../settings/field-row.tsx';
import { AccessReason, accessExplanation } from './access-list.tsx';

const LABELS = {
    createIssuesFromAddItem: 'Create issues from Add item',
    createIssuesFromRetro: 'Create issues from retro captures',
    writeRefinedSpec: 'Write the refined spec to the issue',
} as const;

export type IssueSetting = keyof typeof LABELS;

/** Both setup screens show effective values while keeping saved preferences intact. */
export function IssueDefaults({
    setup,
    disabled = false,
    onChange,
    onRecheck,
    checking = false,
    errors = {},
}: {
    setup: Parameters<typeof effectiveIssueSettings>[0];
    disabled?: boolean;
    onRecheck?: (() => void) | undefined;
    checking?: boolean;
    errors?: Partial<Record<IssueSetting, string>>;
    onChange: (key: IssueSetting, value: boolean) => void;
}) {
    const effective = effectiveIssueSettings(setup);

    return (
        <div className={FIELD_GROUP}>
            {(Object.keys(LABELS) as IssueSetting[]).map((key) => {
                const reason = key === 'writeRefinedSpec' ? effective.specReason : effective.createReason;

                return (
                    <FieldRow
                        key={key}
                        id={key}
                        label={LABELS[key]}
                        error={errors[key]}
                        description={
                            reason && (
                                <AccessReason
                                    repo={setup.repo}
                                    reason={reason}
                                    onRecheck={onRecheck}
                                    checking={checking}
                                />
                            )
                        }
                    >
                        <Switch
                            label={LABELS[key]}
                            description={reason ? accessExplanation(setup.repo, reason) : undefined}
                            on={effective[key]}
                            disabled={disabled || reason !== null}
                            onChange={(on) => onChange(key, on)}
                        />
                    </FieldRow>
                );
            })}
        </div>
    );
}
