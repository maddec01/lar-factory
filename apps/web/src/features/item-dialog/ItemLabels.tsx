// The item dialog's labels fact: the tracker's labels on the item and the picker that edits them.

import { STRUCTURE_LABEL, kindLabels, sameRepo, trackerCapabilities, writeAccessProblem } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Button, Inline, LabelChip, Loading, Text } from '@lar-works/design-system';
import { Pencil, TagIcon } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { useLabelEdit } from './useLabelEdit';
import { LabelChips, useShownLabels } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { LabelPicker } from '@/shared/labels/LabelPicker';
import { ActionError, buttonKind, ChipGroup, DetailFact as Fact, LabelPickerPopover } from '@/ui/board';

/**
 * The tracker's labels on the item, without those its row hides, and the picker that adds and removes them; linked-work
 * shows only as a note, for the factory owns it. Without access the control is disabled with the reason. Local work has no labels.
 */
export function ItemLabels({ item }: { item: Item }) {
    const shown = useShownLabels(item);
    const setup = useBoardStore((state) => state.data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup);
    const edit = useLabelEdit(item);
    const [open, setOpen] = useState(false);
    const [attempted, setAttempted] = useState(false);
    const { heading, noun } = trackerCapabilities(item.repo);

    if (!item.number) return null;

    const linked = item.labels.some((l) => l.toLowerCase() === STRUCTURE_LABEL);
    const problem = writeAccessProblem(item.repo, 'tag-ticket', setup?.access ?? {}, {
        azureReadOnly: setup?.azureReadOnly,
    });
    const openChange = (next: boolean) => {
        if (next && problem) {
            setAttempted(true);

            return;
        }

        setOpen(next);

        if (next) void edit.read();
    };

    return (
        <Fact label={heading} icon={<TagIcon />} labelHidden>
            {attempted && problem && (
                <Text variant="caption" tone="muted" role="status">
                    Ticket labels are read-only. {problem.replace(/ Recheck access in Settings\.$/, '')}
                </Text>
            )}
            <Inline as="span" wrap align="center" space="tight">
                {shown.length === 0 && !linked && (
                    <Text as="span" variant="inherit" tone="muted">
                        {`No ${heading.toLowerCase()} yet.`}
                    </Text>
                )}
                {(shown.length > 0 || linked) && (
                    <ChipGroup data-labels>
                        <LabelChips item={item} />
                        {linked && (
                            <LabelChip
                                data-locked-label=""
                                label={STRUCTURE_LABEL}
                                locked
                                lockedLabel="The factory manages this for saved links, so it can’t be edited."
                            />
                        )}
                    </ChipGroup>
                )}
                {!item.setAside && (
                    <LabelPickerPopover
                        open={open}
                        onOpenChange={openChange}
                        trigger={
                            <Button
                                {...buttonKind('control')}
                                iconOnly
                                leftIcon={<Pencil />}
                                data-edit-labels
                                title={problem ?? undefined}
                                aria-label={`Edit ${heading.toLowerCase()}`}
                            />
                        }
                        footer={edit.error && <ActionError>{edit.error}</ActionError>}
                    >
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
                            !edit.error && <Loading presentation="status" label={`Loading ${noun}s…`} />
                        )}
                    </LabelPickerPopover>
                )}
                {edit.error && !open && <ActionError>{edit.error}</ActionError>}
            </Inline>
        </Fact>
    );
}
