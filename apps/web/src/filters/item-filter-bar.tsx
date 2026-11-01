// List's and the board's filters: Kind and Labels dropdown checklists, the active choices as chips that remove
// themselves, and Clear. Labels offers what `rows`, the items the surface holds, show, whatever the filters hide.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, CircleDashed } from 'lucide-react';
import { trackerCapabilities } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Checkbox } from '@lar-factory/ui/design-system/Checkbox';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Popover } from '@lar-factory/ui/design-system/Popover';
import { useBoardStore } from '../board/board-store.ts';
import { kind as buttonKind } from '../buttons/button-kinds.tsx';
import { KIND_BADGES, KindBadge, tint } from '../items/item-parts.tsx';
import { KIND_FILTERS, filtering, labelChoices, sameLabel } from './item-filters.ts';
import type { ItemFilters, KindFilter, LabelChoice } from './item-filters.ts';

const CHOICE = 'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-(--accent)';

const toggled = <T,>(list: readonly T[], value: T, same: (a: T, b: T) => boolean = Object.is): T[] =>
  (list.some((v) => same(v, value)) ? list.filter((v) => !same(v, value)) : [...list, value]);

const kindName = (choice: KindFilter) => (choice === 'no-kind' ? 'No kind' : KIND_BADGES[choice]!.name);

function KindChoice({ choice, children }: { choice: KindFilter; children?: ReactNode }) {
  return choice === 'no-kind' ? <Badge><CircleDashed aria-hidden="true" />No kind{children}</Badge> : <KindBadge kind={choice}>{children}</KindBadge>;
}

function FilterMenu({ which, name, picked, children }: { which: string; name: string; picked: number; children: ReactNode }) {
  return (
    <Popover>
      <Popover.Trigger asChild><Button {...buttonKind('other')} data-filter={which} rightIcon={<ChevronDown />}>{name}{picked > 0 && ` · ${picked}`}</Button></Popover.Trigger>
      <Popover.Content side="bottom" align="start">{children}</Popover.Content>
    </Popover>
  );
}

function LabelChecklist({ heading, choices, picked, onToggle }: { heading: string; choices: LabelChoice[]; picked: string[]; onToggle: (name: string) => void }) {
  const [query, setQuery] = useState('');
  const hits = choices.filter(({ name }) => name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="grid w-72 gap-2">
      <Input autoFocus placeholder={`Filter ${heading.toLowerCase()}`} aria-label={`Filter ${heading.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="grid max-h-56 gap-0.5 overflow-y-auto">
        {hits.map(({ name, color }) => (
          <label key={name} data-filter-choice className={CHOICE}>
            <Checkbox checked={picked.some((label) => sameLabel(label, name))} onChange={() => onToggle(name)} />
            {color && <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />}
            <span className="min-w-0 flex-1 wrap-anywhere">{name}</span>
          </label>
        ))}
        {!hits.length && <p className="m-0 p-1.5 text-[11px] text-(--muted-foreground)">No match.</p>}
      </div>
    </div>
  );
}

/** A chip that removes its choice. */
function Chip({ name, onRemove, children }: { name: string; onRemove: () => void; children: ReactNode }) {
  return <button type="button" data-filter-chip aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={onRemove}>{children}</button>;
}

const CROSS = <span aria-hidden="true">×</span>;

/** With every row on one tracker, its word for labels; rows across trackers say Labels. */
const headingOf = (rows: readonly Item[]) => {
  const headings = new Set(rows.map((row) => trackerCapabilities(row.repo).heading));
  return headings.size === 1 ? [...headings][0]! : 'Labels';
};

export function ItemFilterBar({ filters, onChange, rows }: { filters: ItemFilters; onChange: (filters: ItemFilters) => void; rows: readonly Item[] }) {
  const repos = useBoardStore((state) => state.data.repos);
  const choices = labelChoices(rows, repos);
  const { kinds, labels } = filters;
  const toggleKind = (choice: KindFilter) => onChange({ kinds: toggled(kinds, choice), labels });
  const toggleLabel = (name: string) => onChange({ kinds, labels: toggled(labels, name, sameLabel) });
  const heading = headingOf(rows);
  return (
    <div data-item-filters className="flex flex-wrap items-center gap-1.5">
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
        <LabelChecklist heading={heading} choices={choices} picked={labels} onToggle={toggleLabel} />
      </FilterMenu>
      {kinds.map((choice) => <Chip key={choice} name={kindName(choice)} onRemove={() => toggleKind(choice)}><KindChoice choice={choice}>{CROSS}</KindChoice></Chip>)}
      {labels.map((label) => (
        <Chip key={label} name={label} onRemove={() => toggleLabel(label)}>
          <Badge className="max-w-full" style={tint(choices.find(({ name }) => sameLabel(name, label))?.color)}><span className="max-w-52 truncate">{label}</span>{CROSS}</Badge>
        </Chip>
      ))}
      {filtering(filters) && <Button {...buttonKind('other')} data-filter-clear onClick={() => onChange({ kinds: [], labels: [] })}>Clear</Button>}
    </div>
  );
}
