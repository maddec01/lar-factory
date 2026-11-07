// The List's sort menu.

import { Button, DropdownMenu } from '@lar-works/design-system';
import { ChevronDown } from '@lar-works/design-system/icons';

import { SORTS, isSort } from './ListSorts';
import type { Sort } from './ListSorts';
import { kind } from '@/shared/ui/buttons/ButtonKinds';

export function SortMenu({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
    return (
        <DropdownMenu>
            <DropdownMenu.Trigger asChild>
                <Button {...kind('other')} className="sort ml-auto" rightIcon={<ChevronDown />}>
                    {SORTS[sort].label}
                </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
                <DropdownMenu.RadioGroup value={sort} onValueChange={(value) => isSort(value) && onSort(value)}>
                    {Object.entries(SORTS).map(([value, { label }]) => (
                        <DropdownMenu.RadioItem key={value} value={value}>
                            {label}
                        </DropdownMenu.RadioItem>
                    ))}
                </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
        </DropdownMenu>
    );
}
