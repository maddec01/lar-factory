// Add item's New item pane: the draft's repository, kind, title and description, and whether to create its ticket.

import { ITEM_KINDS } from '@lar-factory/shared';
import { Button, FormResult, Input, MarkdownEditor, Modal, OptionSelect, Text } from '@lar-works/design-system';
import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { DraftValues } from './AddItemStore';
import { useAddItemStore } from './AddItemStore';
import { CreateIssueBox, IssueFields } from './IssueFields';
import { NoProjectNotice } from './NoProjectNotice';
import { RepoSelect } from './RepoSelect';
import { ticketOptions } from './TicketOptions';
import { KIND_BADGES } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { sampleCapability } from '@/shared/capabilities/sampleCapability';
import { buttonKind, DraftFields, PanelField } from '@/ui/board';

const KIND_CHOICES = ITEM_KINDS.map((value) => {
    const { name, icon: Icon, hue } = KIND_BADGES[value]!;

    return { value, label: name, icon: <Icon />, hue };
});

/** The form's values, the editor's `description` and the Create issue `createChoice`, for the store to keep. */
function valuesOf(form: HTMLFormElement, description: string, createChoice: boolean | null): DraftValues {
    const values = new FormData(form);
    const value = (name: string) => {
        const entry = values.get(name);

        return typeof entry === 'string' ? entry : '';
    };
    const createIssue = values.has('createIssue');
    const options = createIssue ? ticketOptions(form) : undefined;

    return {
        repo: value('repo'),
        kind: value('kind'),
        title: value('title'),
        description,
        createIssue,
        ...(options ? { options } : {}),
        ...(createChoice === null ? {} : { createChoice }),
    };
}

export function AddItemForm() {
    const data = useBoardStore((state) => state.data);
    const { submission, message, submit, edit, keep, reset, setOpen } = useAddItemStore();
    // Read once: the fields start from the kept draft.
    const [kept] = useState(() => useAddItemStore.getState().values);
    const [repo, setRepo] = useState(kept?.repo ?? data.repos[0]?.repo ?? '');
    const [itemKind, setKind] = useState(kept?.kind ?? '');
    const [createChoice, setCreateChoice] = useState(kept?.createChoice ?? null);
    const selected = data.repos.find((r) => r.repo === repo) ?? data.repos[0];
    const form = useRef<HTMLFormElement>(null);
    const kindSelect = useRef<HTMLButtonElement>(null);
    // The editor is no form field, so its Markdown is kept here.
    const description = useRef(kept?.description ?? '');
    const { phase } = submission;
    const locked = phase !== 'editing';
    const keepForm = useCallback(
        () => keep(valuesOf(form.current!, description.current, createChoice)),
        [keep, createChoice],
    );

    // The checkbox's input event comes before this render, so the choice is kept once it has rendered.
    useEffect(() => {
        if (createChoice !== null) keepForm();
    }, [createChoice, keepForm]);

    // An edit in the editor counts as one in the form.
    const onDescription = (markdown: string) => {
        description.current = markdown;
        edit();
        keepForm();
    };

    const onSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        const form = event.currentTarget;

        void submit(valuesOf(form, description.current, createChoice)).then(() => {
            if (
                useAddItemStore.getState().submission.phase === 'editing' &&
                form.isConnected &&
                form.reportValidity() &&
                !itemKind
            )
                kindSelect.current?.focus();
        });
    };

    return (
        <Modal.Form
            ref={form}
            id="add-item-form"
            noValidate
            aria-busy={phase === 'pending'}
            onSubmit={onSubmit}
            onInput={() => {
                edit();
                keepForm();
            }}
        >
            <DraftFields
                id="item-fields"
                disabled={locked}
                detailsLabel="Details"
                main={
                    <>
                        <NoProjectNotice />
                        <Input
                            id="item-title"
                            name="title"
                            presentation="title"
                            required
                            maxLength={256}
                            autoComplete="off"
                            defaultValue={kept?.title}
                            aria-label="Title"
                            placeholder="Title"
                        />
                        <MarkdownEditor
                            label="Description"
                            placeholder="Add a description… - for a list, 1. for steps, # for a heading"
                            value={kept?.description ?? ''}
                            onChange={onDescription}
                            disabled={locked}
                            fill="wide"
                        />
                        <Text variant="caption" tone="muted">
                            Formats as you type · saved as Markdown
                        </Text>
                        {data.capture?.enabled !== false && <FormResult id="item-result" text={message} />}
                    </>
                }
                details={
                    <>
                        <PanelField heading="Project" htmlFor="item-repo">
                            <RepoSelect id="item-repo" repo={selected?.repo ?? ''} onRepo={setRepo} />
                        </PanelField>
                        <PanelField heading="Kind" htmlFor="item-kind">
                            <OptionSelect
                                ref={kindSelect}
                                id="item-kind"
                                name="kind"
                                placeholder="Choose a kind"
                                value={itemKind}
                                onChange={setKind}
                                options={KIND_CHOICES}
                            />
                        </PanelField>
                        {selected && data.capture?.enabled !== false && (
                            <IssueFields
                                key={selected.repo}
                                repo={selected}
                                kind={itemKind}
                                kept={kept?.repo === selected.repo ? kept : null}
                                choice={createChoice}
                            />
                        )}
                    </>
                }
            />
            <Modal.Footer
                leading={
                    selected ? (
                        <CreateIssueBox
                            repo={selected}
                            choice={createChoice}
                            onChoice={setCreateChoice}
                            disabled={locked}
                        />
                    ) : (
                        data.capture?.enabled === false && (
                            <Text variant="caption" tone="muted" id="item-create-reason">
                                {sampleCapability(data, 'createIssue')}
                            </Text>
                        )
                    )
                }
            >
                <Button
                    {...buttonKind('other', { size: 'md' })}
                    id="item-new"
                    hidden={phase !== 'uncertain'}
                    onClick={reset}
                >
                    New item
                </Button>
                <Button {...buttonKind('other', { size: 'md' })} onClick={() => setOpen(false)}>
                    Cancel
                </Button>
                <Button
                    {...buttonKind('main', { size: 'md' })}
                    type="submit"
                    id="item-submit"
                    aria-describedby={data.capture?.enabled === false ? 'item-create-reason' : undefined}
                    disabled={
                        phase === 'pending' ||
                        phase === 'uncertain' ||
                        data.capture?.enabled === false ||
                        !data.repos.length
                    }
                >
                    {phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add item'}
                </Button>
            </Modal.Footer>
        </Modal.Form>
    );
}
