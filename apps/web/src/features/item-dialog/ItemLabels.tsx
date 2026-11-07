// The item dialog's labels fact: the tracker's labels on the item and the picker that edits them.

import { STRUCTURE_LABEL, kindLabels, sameRepo, trackerCapabilities, writeAccessProblem } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import {
    BoardNote,
    ChipGroup,
    DetailFact as Fact,
    IconButton,
    LabelEditorPanel,
    LabelsValue,
    LockedLabel,
    Popover,
} from '@lar-works/design-system';
import { Pencil } from '@lar-works/design-system/icons';
import { useState } from 'react';

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
            <LabelsValue>
                {(shown.length > 0 || linked) && (
                    <ChipGroup data-labels>
                        <LabelChips item={item} />
                        {linked && (
                            <LockedLabel
                                data-locked-label
                                title="The factory manages this for saved links, so it can't be edited."
                            >
                                {STRUCTURE_LABEL}
                            </LockedLabel>
                        )}
                    </ChipGroup>
                )}
                <Popover open={open} onOpenChange={openChange}>
                    <Popover.Trigger asChild>
                        <IconButton
                            variant="inline"
                            data-edit-labels
                            disabled={problem !== null}
                            title={problem ?? undefined}
                            aria-label={`Edit ${heading.toLowerCase()}`}
                            icon={<Pencil />}
                        />
                    </Popover.Trigger>
                    <Popover.Content side="bottom" align="start">
                        <LabelEditorPanel>
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
                                !edit.error && <BoardNote role="status">Reading {noun}s…</BoardNote>
                            )}
                            {edit.error && (
                                <BoardNote tone="error" role="alert">
                                    {edit.error}
                                </BoardNote>
                            )}
                        </LabelEditorPanel>
                    </Popover.Content>
                </Popover>
                {edit.error && !open && (
                    <BoardNote tone="error" role="alert">
                        {edit.error}
                    </BoardNote>
                )}
            </LabelsValue>
        </Fact>
    );
}
