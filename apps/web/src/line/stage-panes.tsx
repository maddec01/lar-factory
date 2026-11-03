// The Shaping, Ready to build and Build sections. Build's header counts the factory's builds against the limit, which it shows but doesn't enforce.

import { useBoardStore } from '../board/board-store.ts';
import { BUILD_LIMIT, buildsInSlots } from '../items/build-slots.ts';
import { STATUS_COLOR, StatusGlyph } from '../items/status-glyph.tsx';
import { Pane, PaneEmpty } from './pane.tsx';
import { StageRow } from './stage-row.tsx';
import type { StageRow as Row } from './stage-rows.ts';

type Shows = (row: Row) => boolean;

function Rows({ rows }: { rows: Row[] }) {
  const data = useBoardStore((state) => state.data);
  return <ol className="m-0 grid list-none p-0">{rows.map((row) => <StageRow key={row.item.id} row={row} data={data} />)}</ol>;
}

export function Shaping({ shaping, shows }: { shaping: Row[]; shows: Shows }) {
  const rows = shaping.filter(shows);
  return (
    <Pane id="shaping" title="Shaping" status="Shaping" count={rows.length}>
      {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={shaping.length > 0} none="Nothing in shaping.">Nothing in shaping matches.</PaneEmpty>}
    </Pane>
  );
}

export function ReadyToBuild({ ready, shows }: { ready: Row[]; shows: Shows }) {
  const rows = ready.filter(shows);
  return (
    <Pane id="ready" title="Ready to build" status="Ready" count={rows.length}>
      {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={ready.length > 0} none="Nothing ready to build.">Nothing ready to build matches.</PaneEmpty>}
    </Pane>
  );
}

/** Builds in progress against the limit, one bar per slot, more when they're over it. */
function BuildSlots({ building }: { building: number }) {
  return (
    <span className="build-slots inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums text-(--muted-foreground)" title="Builds in flight against the limit">
      <span className="inline-flex gap-[3px]">
        {Array.from({ length: Math.max(BUILD_LIMIT, building) }, (_, n) => (
          <span key={n} className="slot h-1.5 w-3 rounded-full" style={{ background: n < building ? STATUS_COLOR['In progress'] : 'var(--border)' }} />
        ))}
      </span>
      {building}/{BUILD_LIMIT} building
    </span>
  );
}

export function Build({ build, shows }: { build: Row[]; shows: Shows }) {
  const building = useBoardStore((state) => buildsInSlots(state.data.items).length);
  const rows = build.filter(shows);
  return (
    <Pane id="build" title="Build" status="In progress" count={rows.length} right={<BuildSlots building={building} />}>
      {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={build.length > 0} none="Nothing in build.">Nothing in build matches.</PaneEmpty>}
    </Pane>
  );
}
