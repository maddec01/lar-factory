// The line: the work moving through the factory, as the Queue, the dossiers, and everything else in flight, under the
// board's filters. Each part takes the items in the main area's scope and which rows the filters leave.

import type { Item } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { ItemFilterBar } from '../filters/item-filter-bar.tsx';
import { rowFilter, useItemFilters } from '../filters/item-filters.ts';
import { dossiersOf } from './dossier-parts.ts';
import { Dossiers } from './dossiers.tsx';
import { InFlight, flightRows } from './in-flight.tsx';
import { Queue, queuedRows } from './queue.tsx';

export function Line({ items }: { items: Item[] }) {
  const { data, now } = useBoardStore();
  const [filters, setFilters] = useItemFilters('board');
  const shows = rowFilter(filters, data.repos);
  const rows = [...queuedRows(items, data.items), ...dossiersOf(items, data.items).map(({ parent }) => parent), ...flightRows(items, data, now)];
  return (
    <section className="line grid gap-3" aria-labelledby="line-h">
      <header data-line-filters className="grid gap-3">
        <h2 id="line-h" className="m-0 text-[13px] font-medium">The line</h2>
        <ItemFilterBar filters={filters} onChange={setFilters} rows={rows} />
      </header>
      <div className="@container grid gap-4">
        <Queue items={items} shows={shows} />
        <Dossiers items={items} shows={shows} />
        <InFlight items={items} shows={shows} />
      </div>
    </section>
  );
}
