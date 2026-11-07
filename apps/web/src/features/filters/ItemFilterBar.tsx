// The List modal's filters: Kind and Labels dropdown checklists, the active choices as chips that remove themselves,
// and Clear. Labels offers what `rows`, the items the modal holds, show, whatever the filters hide.

import { sameLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Badge, Button, Checkbox, Popover } from '@lar-works/design-system';
import { ChevronDown, CircleDashed } from '@lar-works/design-system/icons';
import { useRef, type ReactNode } from 'react';

import { KIND_FILTERS, filtering, headingOf, labelChoices, toggled } from './ItemFilters';
import type { ItemFilters, KindFilter } from './ItemFilters';
import { KIND_BADGES, KindBadge } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { kind as buttonKind } from '@/shared/ui/buttons/ButtonKinds';
import { LabelPicker } from '@/shared/ui/labels/LabelPicker';
import { tint } from '@/shared/ui/labels/LabelTint';

const CHOICE = 'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-(--accent)';

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

function FilterMenu({
    which,
    name,
    picked,
    children,
}: {
    which: string;
    name: string;
    picked: number;
    children: ReactNode;
}) {
    return (
        <Popover>
            <Popover.Trigger asChild>
                <Button {...buttonKind('other')} data-filter={which} rightIcon={<ChevronDown />}>
                    {name}
                    {picked > 0 && ` · ${picked}`}
                </Button>
            </Popover.Trigger>
            <Popover.Content side="bottom" align="start">
                {children}
            </Popover.Content>
        </Popover>
    );
}

/** A chip that removes its choice. */
function Chip({ name, onRemove, children }: { name: string; onRemove: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            data-filter-chip
            aria-label={`Remove ${name}`}
            title={`Remove ${name}`}
            onClick={onRemove}
        >
            {children}
        </button>
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
        <div ref={bar} data-item-filters className="flex flex-wrap items-center gap-1.5">
            <FilterMenu which="kind" name="Kind" picked={kinds.length}>
                <div className="grid w-52 gap-0.5">
                    {KIND_FILTERS.map((choice) => (
                        <label key={choice} data-filter-choice className={CHOICE}>
                            <Checkbox checked={kinds.includes(choice)} onChange={() => toggleKind(choice)} />
                            <KindChoice choice={choice} />
                        </label>
                    ))}
                </div>
            </FilterMenu>
            <FilterMenu which="labels" name={heading} picked={labels.length}>
                <LabelPicker heading={heading} choices={choices} picked={labels} onToggle={toggleLabel} />
            </FilterMenu>
            {kinds.map((choice) => (
                <Chip key={choice} name={kindName(choice)} onRemove={() => thenFocusKind(() => toggleKind(choice))}>
                    <KindChoice choice={choice}>{CROSS}</KindChoice>
                </Chip>
            ))}
            {labels.map((label) => (
                <Chip key={label} name={label} onRemove={() => thenFocusKind(() => toggleLabel(label))}>
                    <Badge
                        className="max-w-full"
                        style={tint(choices.find(({ name }) => sameLabel(name, label))?.color)}
                    >
                        <span className="max-w-52 truncate">{label}</span>
                        {CROSS}
                    </Badge>
                </Chip>
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
        </div>
    );
}
