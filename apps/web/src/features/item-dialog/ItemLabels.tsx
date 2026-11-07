// The item dialog's labels fact: the tracker's labels on the item and the picker that edits them.

import { STRUCTURE_LABEL, kindLabels, sameRepo, trackerCapabilities, writeAccessProblem } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Popover } from '@lar-works/design-system';
import { Lock, Pencil } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { Fact, LABEL_ERROR } from './DetailsParts';
import { useLabelEdit } from './useLabelEdit';
import { LabelChips, useShownLabels } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { LabelPicker } from '@/shared/labels/LabelPicker';

/**
 * The tracker's labels on the item, without those its row hides, and the picker that adds and removes them; linked-work
 * shows only as a note, for the factory owns it. Without access the control is disabled with the reason. Local work has no labels.
 */
export function ItemLabels({ item }: { item: Item }) {
    const shown = useShownLabels(item);
    const setup = useBoardStore((state) => state.data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup);
    const edit = useLabelEdit(item);
    const [open, setOpen] = useState(false);
    const { heading, noun } = trackerCapabilities(item.repo);

    if (!item.number) return null;

    const linked = item.labels.some((l) => l.toLowerCase() === STRUCTURE_LABEL);
    const problem = writeAccessProblem(item.repo, 'tag-ticket', setup?.access ?? {}, {
        azureReadOnly: setup?.azureReadOnly,
    });
    const openChange = (next: boolean) => {
        setOpen(next);

        if (next) void edit.read();
    };

    return (
        <Fact label={heading}>
            <span className="flex flex-wrap items-center gap-1">
                {(shown.length > 0 || linked) && (
                    <span className="contents" data-labels>
                        <LabelChips item={item} />
                        {linked && (
                            <span
                                data-locked-label
                                title="The factory manages this for saved links, so it can't be edited."
                                className="inline-flex items-center gap-1 text-xs text-(--muted-foreground)"
                            >
                                <Lock className="size-3 shrink-0" aria-hidden="true" />
                                {STRUCTURE_LABEL}
                            </span>
                        )}
                    </span>
                )}
                <Popover open={open} onOpenChange={openChange}>
                    <Popover.Trigger asChild>
                        <button
                            type="button"
                            data-edit-labels
                            disabled={problem !== null}
                            title={problem ?? undefined}
                            aria-label={`Edit ${heading.toLowerCase()}`}
                            className="grid size-5 place-items-center rounded text-(--muted-foreground) hover:bg-(--accent) disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                            <Pencil className="size-3" />
                        </button>
                    </Popover.Trigger>
                    <Popover.Content side="bottom" align="start">
                        <div className="grid w-72 gap-2">
                            {edit.choices ? (
                                <LabelPicker
                                    heading={heading}
                                    choices={edit.choices}
                                    picked={item.labels}
                                    locked={kindLabels(item.kind, setup?.vocabulary)}
                                    busy={edit.saving}
                                    onToggle={(name) => void edit.toggle(name)}
                                />
                            ) : (
                                !edit.error && (
                                    <p role="status" className="m-0 text-xs text-(--muted-foreground)">
                                        Reading {noun}s…
                                    </p>
                                )
                            )}
                            {edit.error && (
                                <p role="alert" className={LABEL_ERROR}>
                                    {edit.error}
                                </p>
                            )}
                        </div>
                    </Popover.Content>
                </Popover>
                {edit.error && !open && (
                    <span role="alert" className={LABEL_ERROR}>
                        {edit.error}
                    </span>
                )}
            </span>
        </Fact>
    );
}
