// The board's work by stage: Queue, Shaping, Ready to build and Build as full-width lists from top to
// bottom, then the dock of concepts and linked work, in one page scroll. Rows move between sections as board pushes
// change their placement. A dossier expands in place, under its row.

import type { ReactNode } from 'react';
import { useBoardStore } from '../board/board-store.ts';
import { useScopeStore } from '../board/scope-store.ts';
import { rowFilter } from '../filters/item-filters.ts';
import { useActivityUnavailable } from '../items/item-parts.tsx';
import { RowActions } from '../items/row-actions.tsx';
import type { Item } from '@lar-factory/shared';
import { Dossiers } from './dossiers.tsx';
import { Queue } from './queue.tsx';
import { Build, ReadyToBuild, Shaping } from './stage-panes.tsx';
import { stageRows } from './stage-rows.ts';

/** `items` are the items in the main area's scope; `desk` sits above the stages. */
export function StageLayout({ items, desk }: { items: Item[]; desk: ReactNode }) {
  const data = useBoardStore((state) => state.data);
  const unavailable = useActivityUnavailable();
  const filters = useScopeStore((state) => state.filters);
  const shows = rowFilter(filters, data.repos);
  const showsRow = ({ item }: { item: Item }) => shows(item);
  const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);
  return <>
    {desk}
    <section className="stages flex flex-col gap-3" aria-label="Work by stage">
      <RowActions>
        <Queue rows={queue} shows={showsRow} />
        <Shaping shaping={shaping} shows={showsRow} />
        <ReadyToBuild ready={ready} shows={showsRow} />
        <Build build={build} shows={showsRow} />
        <Dossiers dossiers={dock.filter(({ parent }) => shows(parent))} />
      </RowActions>
    </section>
  </>;
}
