import type { Item } from '@lar-factory/shared';
// The List modal's filters: Kind and Labels dropdown checklists, the active choices as chips that remove themselves,
// and Clear. Labels offers what `rows`, the items the modal holds, show, whatever the filters hide.
import { sameLabel } from '@lar-factory/shared';
import { Badge, Button, LabelChip } from '@lar-works/design-system';
import { useRef, type ReactNode } from 'react';

import type { ItemFilters, KindFilter } from './ItemFilters';
import { filtering, headingOf, KIND_FILTERS, labelChoices, toggled } from './ItemFilters';
import { kindName } from './KindFilterNames';
import { KindBadge } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { LabelPicker } from '@/shared/labels/LabelPicker';
import { buttonKind, conceptIcons, FilterBar, FilterChip, FilterChoice, FilterChoices, FilterMenu } from '@/ui/board';

const NoKindIcon = conceptIcons.noKind;

function KindChoice({ choice, children }: { choice: KindFilter; children?: ReactNode }) {
    return choice === 'no-kind' ? (
        <Badge>
            <NoKindIcon aria-hidden="true" />
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
                    <LabelChip
                        label={label}
                        color={choices.find(({ name }) => sameLabel(name, label))?.color}
                        removable
                    />
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
