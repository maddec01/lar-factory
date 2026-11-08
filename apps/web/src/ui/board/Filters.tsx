import { Button, Checkbox, Popover } from '@lar-works/design-system';
import { ChevronDownIcon } from '@lar-works/design-system/icons';
import { forwardRef, type ReactNode } from 'react';

import { buttonKind } from './ButtonKinds';

interface FilterBarProps {
    /** The filter menus, the active chips and Clear. */
    children: ReactNode;
}

/** The List's filters: menus of checklists, then the active choices as chips that remove themselves, then Clear. */
export const FilterBar = forwardRef<HTMLDivElement, FilterBarProps>(({ children }, ref) => (
    <div ref={ref} data-item-filters className="flex flex-wrap items-center gap-1.5">
        {children}
    </div>
));

FilterBar.displayName = 'FilterBar';

interface FilterMenuProps {
    /** What the menu filters, as `data-filter`. */
    which: string;
    /** The filter's name, such as "Kind". */
    name: string;
    /** How many of its choices are on, after its name. */
    picked: number;
    /** The filter's FilterChoices. */
    children: ReactNode;
}

/** A filter's button, its name and how many choices are on, opening its checklist. */
export function FilterMenu({ which, name, picked, children }: FilterMenuProps) {
    return (
        <Popover>
            <Popover.Trigger asChild>
                <Button {...buttonKind('other')} data-filter={which} rightIcon={<ChevronDownIcon />}>
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

/** A filter menu's checklist. */
export function FilterChoices({
    children,
}: {
    /** The choices, one FilterChoice each. */
    children: ReactNode;
}) {
    return <div className="grid w-52 gap-0.5">{children}</div>;
}

/** One choice in a filter's checklist: its checkbox, then what it is, such as a badge. */
export function FilterChoice({
    checked,
    onToggle,
    children,
}: {
    /** The choice is on. */
    checked: boolean;
    /** Called as the reader turns the choice on or off. */
    onToggle: () => void;
    /** What the choice is, such as a badge. */
    children: ReactNode;
}) {
    return (
        <label
            data-filter-choice
            className="hover:bg-fill-hover flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs"
        >
            <Checkbox checked={checked} onChange={onToggle} />
            {children}
        </label>
    );
}

/** An active choice as a chip, such as a badge ending in ×, which removes the choice. */
export function FilterChip({
    removeLabel,
    onRemove,
    children,
}: {
    /** The chip's accessible name, such as "Remove Bug". */
    removeLabel: string;
    /** Called as the reader removes the choice. */
    onRemove: () => void;
    /** The choice, such as a badge. */
    children: ReactNode;
}) {
    return (
        <button type="button" data-filter-chip title={removeLabel} onClick={onRemove}>
            <span className="sr-only">{removeLabel}:</span> {children}
        </button>
    );
}
