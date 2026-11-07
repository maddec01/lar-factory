// The List modal's filters: Kind and Labels dropdown checklists, the active choices as chips that remove themselves,
// and Clear. Labels offers what `rows`, the items the modal holds, show, whatever the filters hide.

import { sameLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import {
    Badge,
    Button,
    buttonKind,
    FilterBar,
    FilterChip,
    FilterChoice,
    FilterChoices,
    FilterLabelBadge,
    FilterMenu,
} from '@lar-works/design-system';
import { CircleDashed } from '@lar-works/design-system/icons';
import { useRef, type ReactNode } from 'react';

import { KIND_FILTERS, filtering, headingOf, labelChoices, toggled } from './ItemFilters';
import type { ItemFilters, KindFilter } from './ItemFilters';
import { KIND_BADGES, KindBadge } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { LabelPicker } from '@/shared/labels/LabelPicker';

export const kindName = (choice: KindFilter) => (choice === 'no-kind' ? 'No kind' : KIND_BADGES[choice]!.name);

function KindChoice({ choice, children }: { choice: KindFilter; children?: ReactNode }) {
    return choice === 'no-kind' ? (
        <Badge>
            <CircleDashed aria-hidden="true" />
            No kind{children}
        </Badge>
    ) : (
        <KindBadge kind={choice}>{children}</KindBadge>
    );
}

const CROSS = <span aria-hidden="true">×</span>;

export function ItemFilterBar({
    filters,
    onChange,
    rows,
}: {
    filters: ItemFilters;
    onChange: (filters: ItemFilters) => void;
    rows: readonly Item[];
}) {
    const repos = useBoardStore((state) => state.data.repos);
    const choices = labelChoices(rows, repos);
    const { kinds, labels } = filters;
    const toggleKind = (choice: KindFilter) => onChange({ kinds: toggled(kinds, choice), labels });
    const toggleLabel = (name: string) => onChange({ kinds, labels: toggled(labels, name, sameLabel) });
    const heading = headingOf(rows);
    const bar = useRef<HTMLDivElement>(null);
    /** Removing a chip or clearing takes away the control that had focus, so focus moves to the Kind menu, which always stays. */
    const thenFocusKind = (remove: () => void) => {
        bar.current?.querySelector<HTMLElement>('[data-filter="kind"]')?.focus();
        remove();
    };

    return (
        <FilterBar ref={bar}>
            <FilterMenu which="kind" name="Kind" picked={kinds.length}>
                <FilterChoices>
                    {KIND_FILTERS.map((choice) => (
                        <FilterChoice key={choice} checked={kinds.includes(choice)} onToggle={() => toggleKind(choice)}>
                            <KindChoice choice={choice} />
                        </FilterChoice>
                    ))}
                </FilterChoices>
            </FilterMenu>
            <FilterMenu which="labels" name={heading} picked={labels.length}>
                <LabelPicker heading={heading} choices={choices} picked={labels} onToggle={toggleLabel} />
            </FilterMenu>
            {kinds.map((choice) => (
                <FilterChip
                    key={choice}
                    removeLabel={`Remove ${kindName(choice)}`}
                    onRemove={() => thenFocusKind(() => toggleKind(choice))}
                >
                    <KindChoice choice={choice}>{CROSS}</KindChoice>
                </FilterChip>
            ))}
            {labels.map((label) => (
                <FilterChip
                    key={label}
                    removeLabel={`Remove ${label}`}
                    onRemove={() => thenFocusKind(() => toggleLabel(label))}
                >
                    <FilterLabelBadge label={label} color={choices.find(({ name }) => sameLabel(name, label))?.color} />
                </FilterChip>
            ))}
            {filtering(filters) && (
                <Button
                    {...buttonKind('other')}
                    data-filter-clear
                    onClick={() => thenFocusKind(() => onChange({ kinds: [], labels: [] }))}
                >
                    Clear
                </Button>
            )}
        </FilterBar>
    );
}
