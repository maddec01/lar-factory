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
    // A submit with no title or kind says so under that field, in the design system's error, not the browser's bubble.
    const [titleMissing, setTitleMissing] = useState(false);
    const [kindMissing, setKindMissing] = useState(false);
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
        const title = form.elements.namedItem('title');
        const noTitle = title instanceof HTMLInputElement && !title.value.trim();

        // What the form can tell is missing is said under its field before anything is sent.
        if (noTitle || !itemKind) {
            setTitleMissing(noTitle);
            setKindMissing(!itemKind);

            if (noTitle) (title as HTMLInputElement).focus();
            else kindSelect.current?.focus();

            return;
        }

        void submit(valuesOf(form, description.current, createChoice));
    };

    return (
        <Modal.Form
            ref={form}
            id="add-item-form"
            noValidate
            aria-busy={phase === 'pending'}
            onSubmit={onSubmit}
            onInput={() => {
                setTitleMissing(false);
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
                        {/* A labelled field, as the details' are, so the one required input reads as one. */}
                        <PanelField heading="Title" htmlFor="item-title">
                            <Input
                                id="item-title"
                                name="title"
                                required
                                maxLength={256}
                                autoComplete="off"
                                defaultValue={kept?.title}
                                placeholder="What needs doing?"
                                invalid={titleMissing}
                                aria-describedby={titleMissing ? 'item-title-error' : undefined}
                            />
                            {titleMissing && (
                                <Text variant="caption" tone="danger" id="item-title-error">
                                    Give the item a title.
                                </Text>
                            )}
                        </PanelField>
                        <MarkdownEditor
                            label="Description"
                            placeholder="Description"
                            value={kept?.description ?? ''}
                            onChange={onDescription}
                            disabled={locked}
                        />
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
                                onChange={(kind) => {
                                    setKindMissing(false);
                                    setKind(kind);
                                }}
                                options={KIND_CHOICES}
                                aria-describedby={kindMissing ? 'item-kind-error' : undefined}
                            />
                            {kindMissing && (
                                <Text variant="caption" tone="danger" id="item-kind-error">
                                    Choose bug, feature or improvement.
                                </Text>
                            )}
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
