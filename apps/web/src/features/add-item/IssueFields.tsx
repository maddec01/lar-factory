import {
    effectiveIssueSettings,
    trackerCapabilities,
    writeAccessProblem,
    type RepoConfig,
    type TicketCreationOptions,
    type TicketOptions,
} from '@lar-factory/shared';
// Add item's Create issue checkbox follows the repository's default until this item changes it, and shows the optional provider fields.
import { Alert, Button, Checkbox, InlineLink, Loading, OptionSelect, Stack, Text } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import type { DraftValues } from './AddItemStore';
import { DraftLabels } from './DraftLabels';
import { useEditStore } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { readTicketOptions } from '@/services/tickets/tickets.service';
import { sampleCapability } from '@/shared/capabilities/sampleCapability';
import { CreateIssueChoice, DraftTicketPart, PanelField } from '@/ui/board';

/** An optional ticket field, for a form to read; a value no longer among its choices starts at None. */
function OptionField({
    name,
    label,
    choices,
    value: start = '',
}: {
    name: string;
    label: string;
    choices: { value: string; label: string }[];
    value?: string;
}) {
    const [value, setValue] = useState(() => (choices.some((choice) => choice.value === start) ? start : ''));

    return (
        choices.length > 0 && (
            <PanelField heading={label} htmlFor={`item-${name}`}>
                <OptionSelect
                    id={`item-${name}`}
                    name={name}
                    none="None"
                    value={value}
                    onChange={setValue}
                    options={choices}
                />
            </PanelField>
        )
    );
}

export function TicketOptionFields({ repo, kind, kept }: { repo: RepoConfig; kind: string; kept?: TicketOptions }) {
    const [read, setRead] = useState<TicketCreationOptions | null>(null);
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let current = true;

        void readTicketOptions(repo.repo)
            .then((options) => {
                if (current) setRead(options);
            })
            .catch(() => {
                if (current) setError('Couldn’t read issue options. You can still submit the title and description.');
            });

        return () => {
            current = false;
        };
    }, [repo.repo, attempt]);

    if (error)
        return (
            <Alert
                size="sm"
                tone="warning"
                title="Couldn’t read issue options"
                description="You can still submit the title and description."
                action={
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                            setError('');
                            setRead(null);
                            setAttempt((n) => n + 1);
                        }}
                    >
                        Try again
                    </Button>
                }
            />
        );

    if (!read) return <Loading presentation="status" label="Reading issue options… You can submit while they load." />;

    const setup = repo.setup;
    const access = setup?.access ?? {};
    const safety = { azureReadOnly: setup?.azureReadOnly };
    const mapping = setup?.vocabulary[kind as 'bug' | 'feature' | 'improvement'];
    const type = kept?.type ?? mapping?.type ?? '';
    const names = (values: string[]) => values.map((value) => ({ value, label: value }));
    const labelsShown =
        !writeAccessProblem(repo.repo, 'tag-ticket', access, safety) &&
        (read.labels.length > 0 || !writeAccessProblem(repo.repo, 'manage-labels', access, safety));

    return (
        <Stack>
            {read.problems.length > 0 && (
                <Text variant="caption" tone="muted" role="status">
                    Some issue options couldn’t be read. You can still submit the title and description.
                </Text>
            )}
            {labelsShown && <DraftLabels repo={repo} kind={kind} read={read} kept={kept} />}
            {!writeAccessProblem(repo.repo, 'type-ticket', access, safety) && (
                <OptionField
                    key={kind}
                    name="type"
                    label={read.provider === 'azure' ? 'Work item type' : 'Issue type'}
                    choices={names(read.types)}
                    value={type}
                />
            )}
            <OptionField name="assignee" label="Assignee" choices={names(read.assignees)} value={kept?.assignee} />
            {read.provider === 'github' && (
                <OptionField
                    name="milestone"
                    label="Milestone"
                    choices={read.milestones.map(({ value, name }) => ({ value, label: name }))}
                    value={kept?.milestone}
                />
            )}
            {read.provider === 'azure' && (
                <OptionField
                    name="iteration"
                    label="Iteration"
                    choices={names(read.iterations)}
                    value={kept?.iteration}
                />
            )}
        </Stack>
    );
}

/** Whether Add item creates a ticket in `repo` under this item's `choice`, null until changed, and why it can't. */
function createIssueState(repo: RepoConfig, choice: boolean | null): { checked: boolean; reason: string | null } {
    const effective = repo.setup ? effectiveIssueSettings(repo.setup) : null;
    const reason = effective?.createReason ?? (effective ? null : 'Issue access isn’t checked yet.');

    return { checked: !reason && (choice ?? effective?.createIssuesFromAddItem ?? false), reason };
}

/** The Create issue checkbox, with the reason when it's disabled. */
export function CreateIssueBox({
    repo,
    choice,
    onChoice,
    disabled,
}: {
    repo: RepoConfig;
    choice: boolean | null;
    onChoice: (checked: boolean) => void;
    disabled: boolean;
}) {
    const sampleReason = useBoardStore((state) => sampleCapability(state.data, 'createIssue'));
    const sample = !!sampleReason;
    const running = useEditStore((state) => state.running);
    const error = useEditStore((state) => state.errors[repo.repo]);
    const creation = createIssueState(repo, choice);
    const reason = sampleReason ?? creation.reason;
    const checked = !reason && creation.checked;

    return (
        <CreateIssueChoice
            checkbox={
                <Checkbox
                    id="item-create-issue"
                    name="createIssue"
                    label="Create issue"
                    checked={checked}
                    disabled={disabled || !!reason}
                    aria-describedby={reason ? 'item-create-reason' : undefined}
                    onChange={(event) => onChoice(event.target.checked)}
                />
            }
            reason={
                reason && (
                    <Text variant="caption" tone="muted" id="item-create-reason">
                        {/* Recheck access sits right here, so the reason doesn't send the reader to Settings for it. */}
                        {reason.replace(/\s*Recheck access in Settings\.$/, '')}
                        {!sample && (
                            <>
                                {' '}
                                <InlineLink
                                    disabled={sample || disabled || running !== null}
                                    onClick={() => void useEditStore.getState().recheck(repo.repo)}
                                >
                                    Recheck access
                                </InlineLink>
                            </>
                        )}
                    </Text>
                )
            }
            error={
                !sample &&
                error && (
                    <Text variant="caption" tone="muted" role="status">
                        {error}
                    </Text>
                )
            }
        />
    );
}

/** The side panel's part of Create issue: the ticket fields when it's on, or what local work has when it's off. */
export function IssueFields({
    repo,
    kind,
    kept,
    choice,
}: {
    repo: RepoConfig;
    kind: string;
    kept?: DraftValues | null;
    choice: boolean | null;
}) {
    const sampleReason = useBoardStore((state) => sampleCapability(state.data, 'createIssue'));
    const creation = createIssueState(repo, choice);
    const reason = sampleReason ?? creation.reason;
    const checked = !reason && creation.checked;

    return (
        <DraftTicketPart>
            {checked ? (
                <TicketOptionFields repo={repo} kind={kind} kept={kept?.kind === kind ? kept.options : undefined} />
            ) : (
                <Text variant="caption" tone="muted">
                    Local items have a kind.
                    {reason
                        ? ''
                        : ` Tick Create issue to add ${trackerCapabilities(repo.repo).heading.toLowerCase()}.`}{' '}
                    Saved only on this machine.
                </Text>
            )}
        </DraftTicketPart>
    );
}
