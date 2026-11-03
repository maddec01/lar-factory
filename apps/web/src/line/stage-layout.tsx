// The board's work by stage, under its filters: Queue, Shaping, Ready to build and Build as full-width lists from top to
// bottom, then the dock of concepts and linked work, in one page scroll. Rows move between sections as board pushes
// change their placement. An opened dossier takes the whole workspace until Back or Escape, or until it leaves the board.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBoardStore } from '../board/board-store.ts';
import { ItemFilterBar } from '../filters/item-filter-bar.tsx';
import { rowFilter, useItemFilters } from '../filters/item-filters.ts';
import { useActivityUnavailable } from '../items/item-parts.tsx';
import type { Item } from '@lar-factory/shared';
import { Dossiers, OpenDossier } from './dossiers.tsx';
import { Queue } from './queue.tsx';
import { Build, ReadyToBuild, Shaping } from './stage-panes.tsx';
import { stageRows } from './stage-rows.ts';

/** `items` are the items in the main area's scope; `desk` sits above the filters while no dossier is open. */
export function StageLayout({ items, desk }: { items: Item[]; desk: ReactNode }) {
  const data = useBoardStore((state) => state.data);
  const unavailable = useActivityUnavailable();
  const [filters, setFilters] = useItemFilters('board');
  const shows = rowFilter(filters, data.repos);
  const showsRow = ({ item }: { item: Item }) => shows(item);
  const { queue, shaping, ready, build, dock } = stageRows(items, data, unavailable);
  const filterable = [...queue, ...shaping, ...ready, ...build].map(({ item }) => item).concat(dock.map(({ parent }) => parent));

  const [openId, setOpenId] = useState<string | null>(null);
  // Read from the whole dock, so a filter never closes it. One that leaves stays closed if it comes back.
  const opened = dock.find(({ parent }) => parent.id === openId);
  if (openId && !opened) setOpenId(null);
  // Back on the panes, focus returns to the row that opened the dossier.
  const lastOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!openId && lastOpen.current) document.querySelector<HTMLElement>(`[data-dossier="${lastOpen.current}"] [data-dossier-open]`)?.focus();
    lastOpen.current = openId;
  }, [openId]);

  if (opened) return <OpenDossier dossier={opened} onBack={() => setOpenId(null)} />;
  return <>
    {desk}
    <section className="stages flex flex-col gap-2.5" aria-label="Work by stage">
      <div data-line-filters><ItemFilterBar filters={filters} onChange={setFilters} rows={filterable} /></div>
      <Queue rows={queue} shows={showsRow} />
      <Shaping shaping={shaping} shows={showsRow} />
      <ReadyToBuild ready={ready} shows={showsRow} />
      <Build build={build} shows={showsRow} />
      <Dossiers dossiers={dock.filter(({ parent }) => shows(parent))} onOpen={setOpenId} />
    </section>
  </>;
}
