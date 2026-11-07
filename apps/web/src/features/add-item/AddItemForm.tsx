// Add item's New item pane: the draft's repository, kind, title and description, and whether to create its ticket.

import { ITEM_KINDS } from '@lar-factory/shared';
import { Fieldset } from '@lar-factory/ui/fieldset';
import { FormSelect } from '@lar-factory/ui/form-select';
import { Button, Modal } from '@lar-works/design-system';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { useAddItemStore } from './AddItemStore';
import type { DraftValues } from './AddItemStore';
import { CreateIssueBox, IssueFields, PanelSection, ticketOptions } from './IssueFields';
import { HINT, RepoSelect } from './RepoSelect';
import { KIND_BADGES } from '@/features/items';
import { FormResult } from '@/features/notices';
import { useBoardStore } from '@/services/board/board.hooks';
import { kind } from '@/shared/ui/buttons/ButtonKinds';
import { DescriptionEditor } from '@/shared/ui/description-editor/DescriptionEditor';

const KIND_CHOICES = ITEM_KINDS.map((value) => {
    const { name, icon: Icon, hue } = KIND_BADGES[value]!;

    return { value, name, icon: <Icon style={{ color: `oklch(0.62 0.15 ${hue})` }} /> };
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
    const keepForm = () => keep(valuesOf(form.current!, description.current, createChoice));

    // The checkbox's input event comes before this render, so the choice is kept once it has rendered.
    useEffect(() => {
        if (createChoice !== null) keepForm();
    }, [createChoice]);

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
            {/* Narrower than 40rem, the side panel stacks under the editor, which grows with its text, and the two scroll as one;
          each row sizes to its content, so a long text pushes the panel down rather than running under it. */}
            <div className="@container flex min-h-0 flex-1 flex-col">
                <Fieldset
                    id="item-fields"
                    unstyled
                    disabled={locked}
                    className="border-base-300 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_16rem] border-t @max-[40rem]:auto-rows-max @max-[40rem]:grid-cols-[minmax(0,1fr)] @max-[40rem]:content-start @max-[40rem]:overflow-y-auto"
                >
                    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-5 pt-4 pb-5 sm:px-6 @max-[40rem]:min-h-80 @max-[40rem]:overflow-visible">
                        <input
                            id="item-title"
                            name="title"
                            required
                            maxLength={256}
                            autoComplete="off"
                            defaultValue={kept?.title}
                            aria-label="Title"
                            placeholder="Title"
                            className="text-base-content w-full shrink-0 border-0 bg-transparent p-0 text-xl font-semibold tracking-tight outline-none placeholder:font-medium placeholder:text-(--muted-foreground)"
                        />
                        <DescriptionEditor
                            label="Description"
                            placeholder="Add a description… - for a list, 1. for steps, # for a heading"
                            value={kept?.description ?? ''}
                            onChange={onDescription}
                            disabled={locked}
                            fill="wide"
                        />
                        <p className={`${HINT} shrink-0`}>Formats as you type · saved as Markdown</p>
                        <FormResult id="item-result" text={message} />
                    </div>
                    <aside
                        aria-label="Details"
                        className="border-base-300 bg-base-50/60 grid content-start gap-5 overflow-y-auto border-l px-4 py-4 @max-[40rem]:overflow-visible @max-[40rem]:border-t @max-[40rem]:border-l-0"
                    >
                        <PanelSection heading="Project" htmlFor="item-repo">
                            <RepoSelect id="item-repo" repo={selected?.repo ?? ''} onRepo={setRepo} />
                        </PanelSection>
                        <PanelSection heading="Kind" htmlFor="item-kind">
                            <FormSelect
                                ref={kindSelect}
                                id="item-kind"
                                name="kind"
                                placeholder="Choose a kind"
                                value={itemKind}
                                onChange={setKind}
                                choices={KIND_CHOICES}
                            />
                        </PanelSection>
                        {selected && (
                            <IssueFields
                                key={selected.repo}
                                repo={selected}
                                kind={itemKind}
                                kept={kept?.repo === selected.repo ? kept : null}
                                choice={createChoice}
                            />
                        )}
                    </aside>
                </Fieldset>
            </div>
            <Modal.Footer
                leading={
                    selected && (
                        <CreateIssueBox
                            repo={selected}
                            choice={createChoice}
                            onChoice={setCreateChoice}
                            disabled={locked}
                        />
                    )
                }
            >
                <Button {...kind('other')} id="item-new" hidden={phase !== 'uncertain'} onClick={reset}>
                    New item
                </Button>
                <Button {...kind('other')} onClick={() => setOpen(false)}>
                    Cancel
                </Button>
                <Button
                    {...kind('main')}
                    type="submit"
                    id="item-submit"
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
