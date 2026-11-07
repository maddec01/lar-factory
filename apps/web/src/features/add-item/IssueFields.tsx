import {
    effectiveIssueSettings,
    trackerCapabilities,
    writeAccessProblem,
    type RepoConfig,
    type TicketCreationOptions,
    type TicketOptions,
} from '@lar-factory/shared';
// Add item's Create issue checkbox follows the repository's default until this item changes it, and shows the optional provider fields.
import {
    Checkbox,
    CreateIssueChoice,
    DraftTicketPart,
    FormSelect,
    InlineButton,
    PanelField,
    Stack,
    Text,
} from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import type { DraftValues } from './AddItemStore';
import { DraftLabels } from './DraftLabels';
import { useEditStore } from '@/features/repositories';

/** An optional ticket field, for a form to read; a value no longer among its choices starts at None. */
function OptionField({
    name,
    label,
    choices,
    value: start = '',
}: {
    name: string;
    label: string;
    choices: { value: string; name: string }[];
    value?: string;
}) {
    const [value, setValue] = useState(() => (choices.some((choice) => choice.value === start) ? start : ''));

    return (
        choices.length > 0 && (
            <PanelField heading={label} htmlFor={`item-${name}`}>
                <FormSelect
                    id={`item-${name}`}
                    name={name}
                    none="None"
                    value={value}
                    onChange={setValue}
                    choices={choices}
                />
            </PanelField>
        )
    );
}

export function TicketOptionFields({ repo, kind, kept }: { repo: RepoConfig; kind: string; kept?: TicketOptions }) {
    const [read, setRead] = useState<TicketCreationOptions | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let current = true;

        void fetch(`/api/ticket-options?repo=${encodeURIComponent(repo.repo)}`)
            .then(async (response) => {
                const result = (await response.json()) as { options?: TicketCreationOptions; error?: string };

                if (!response.ok || !result.options) throw Error(result.error ?? 'Could not read issue options.');

                if (current) setRead(result.options);
            })
            .catch(() => {
                if (current) setError('Could not read issue options. You can still submit the title and description.');
            });

        return () => {
            current = false;
        };
    }, [repo.repo]);

    if (error)
        return (
            <Text variant="caption" tone="muted" role="status">
                {error}
            </Text>
        );

    if (!read)
        return (
            <Text variant="caption" tone="muted" role="status">
                Reading issue options… You can submit while they load.
            </Text>
        );

    const setup = repo.setup;
    const access = setup?.access ?? {};
    const safety = { azureReadOnly: setup?.azureReadOnly };
    const mapping = setup?.vocabulary[kind as 'bug' | 'feature' | 'improvement'];
    const type = kept?.type ?? mapping?.type ?? '';
    const names = (values: string[]) => values.map((value) => ({ value, name: value }));
    const labelsShown =
        !writeAccessProblem(repo.repo, 'tag-ticket', access, safety) &&
        (read.labels.length > 0 || !writeAccessProblem(repo.repo, 'manage-labels', access, safety));

    return (
        <Stack>
            {read.problems.length > 0 && (
                <Text variant="caption" tone="muted" role="status">
                    Some issue options could not be read. You can still submit the title and description.
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
                <OptionField name="milestone" label="Milestone" choices={read.milestones} value={kept?.milestone} />
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
    const reason =
        effective?.createReason ?? (effective ? null : 'Issue access is not checked yet. Recheck access in Settings.');

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
    const running = useEditStore((state) => state.running);
    const error = useEditStore((state) => state.errors[repo.repo]);
    const { checked, reason } = createIssueState(repo, choice);

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
                        {reason}{' '}
                        <InlineButton
                            disabled={disabled || running !== null}
                            onClick={() => void useEditStore.getState().recheck(repo.repo)}
                        >
                            Recheck access
                        </InlineButton>
                    </Text>
                )
            }
            error={
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
    const { checked, reason } = createIssueState(repo, choice);

    return (
        <DraftTicketPart>
            {checked ? (
                <TicketOptionFields repo={repo} kind={kind} kept={kept?.kind === kind ? kept.options : undefined} />
            ) : (
                <Text variant="caption" tone="muted">
                    Local work has its kind alone.
                    {reason
                        ? ''
                        : ` Tick Create issue to add ${trackerCapabilities(repo.repo).heading.toLowerCase()}.`}{' '}
                    Saved only on this machine.
                </Text>
            )}
        </DraftTicketPart>
    );
}

/** Both forms submit exactly the optional fields currently visible. */
export function ticketOptions(form: HTMLFormElement): TicketOptions {
    const values = new FormData(form);

    return {
        ...(form.querySelector('#item-labels') ? { labels: values.getAll('labels').map(String) } : {}),
        ...(values.has('newLabels') ? { newLabels: values.getAll('newLabels').map(String) } : {}),
        ...Object.fromEntries(
            ['type', 'assignee', 'milestone', 'iteration']
                .filter((name) => values.has(name))
                .map((name) => {
                    const entry = values.get(name);

                    return [name, typeof entry === 'string' ? entry : ''];
                }),
        ),
    };
}
