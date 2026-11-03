// The board's work by stage, under its filters: a narrow Queue rail beside the Shaping and Build panes, with the dock of
// concepts and linked work below them. Each section scrolls inside itself, and rows move between sections as board
// pushes change their placement.

import { useBoardStore } from '../board/board-store.ts';
import { ItemFilterBar } from '../filters/item-filter-bar.tsx';
import { rowFilter, useItemFilters } from '../filters/item-filters.ts';
import { useActivityUnavailable } from '../items/item-parts.tsx';
import type { Item } from '@lar-factory/shared';
import { Dossiers } from './dossiers.tsx';
import { Queue } from './queue.tsx';
import { Build, Shaping } from './stage-panes.tsx';
import { stageRows } from './stage-rows.ts';

/** `items` are the items in the main area's scope. */
export function StageLayout({ items }: { items: Item[] }) {
  const data = useBoardStore((state) => state.data);
  const unavailable = useActivityUnavailable();
  const [filters, setFilters] = useItemFilters('board');
  const shows = rowFilter(filters, data.repos);
  const showsRow = ({ item }: { item: Item }) => shows(item);
  const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);
  const filterable = [...queue, ...shaping, ...ready, ...build].map(({ item }) => item).concat(dock.map(({ parent }) => parent));
  return (
    <section className="stages flex min-h-0 flex-1 flex-col gap-2.5" aria-label="Work by stage">
      <div data-line-filters className="shrink-0"><ItemFilterBar filters={filters} onChange={setFilters} rows={filterable} /></div>
      <div className="grid min-h-0 flex-1 grid-cols-[13.5rem_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-3">
        <Queue rows={queue} shows={showsRow} />
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-3">
            <Shaping shaping={shaping} ready={ready} shows={showsRow} />
            <Build build={build} shows={showsRow} />
          </div>
          <Dossiers dossiers={dock.filter(({ parent }) => shows(parent))} />
        </div>
      </div>
    </section>
  );
}
