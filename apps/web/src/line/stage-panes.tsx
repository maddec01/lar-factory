// The Shaping and Build panes. Shaping's Ready to build group stays in view under its scrolling rows. Build's header
// counts the factory's builds against the limit, which it shows but doesn't enforce.

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

function ReadyToBuild({ rows, filtered }: { rows: Row[]; filtered: boolean }) {
  return (
    <div data-ready className="flex max-h-[55%] shrink-0 flex-col border-t border-(--border)">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-(--border) bg-(--soft) px-3 py-1 text-[11px] font-medium text-(--muted-foreground)">
        <StatusGlyph status="Ready" className="size-3" />Ready to build <span className="font-normal tabular-nums">{rows.length}</span>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={filtered} none="Nothing ready to build.">Nothing ready to build matches.</PaneEmpty>}
      </div>
    </div>
  );
}

export function Shaping({ shaping, ready, shows }: { shaping: Row[]; ready: Row[]; shows: Shows }) {
  const rows = shaping.filter(shows);
  const readyRows = ready.filter(shows);
  return (
    <Pane id="shaping" title="Shaping" status="Shaping" count={rows.length + readyRows.length} footer={<ReadyToBuild rows={readyRows} filtered={ready.length > 0} />}>
      {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={shaping.length > 0} none="Nothing in shaping.">Nothing in shaping matches.</PaneEmpty>}
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
