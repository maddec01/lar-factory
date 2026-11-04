// The Shaping, Ready to build and Build sections. Ready to build's header holds the Auto-build switch, and Build's counts the
// factory's builds at work against the build limit.

import { activityUnavailable, buildsAtWork, limitNumber } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { STATUS_COLOR, useStatusActivity } from '../items/status-glyph.tsx';
import { AutoBuildSwitch } from './auto-build-switch.tsx';
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
    <Pane id="ready" title="Ready to build" status="Ready" count={rows.length} right={<AutoBuildSwitch />}>
      {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={ready.length > 0} none="Nothing ready to build.">Nothing ready to build matches.</PaneEmpty>}
    </Pane>
  );
}

/** Builds at work against the build limit, one bar per build it allows, more when they're over it. */
function BuildLimit({ building, limit }: { building: number; limit: number | undefined }) {
  return (
    <span className="build-limit inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums text-(--muted-foreground)" title="Builds at work against the build limit">
      {limit !== undefined && <span className="inline-flex gap-[3px]">
        {Array.from({ length: Math.max(limit, building) }, (_, n) => (
          <span key={n} className="bar h-1.5 w-3 rounded-full" style={{ background: n < building ? STATUS_COLOR['In progress'] : 'var(--border)' }} />
        ))}
      </span>}
      {building}{limit !== undefined && `/${limit}`} building
    </span>
  );
}

export function Build({ build, shows }: { build: Row[]; shows: Shows }) {
  const building = useBoardStore((state) => buildsAtWork(state.data, activityUnavailable(state.data, state.now, state.clientError)).length);
  const buildLimit = useBoardStore((state) => state.data.buildLimit);
  const rows = build.filter(shows);
  const running = useStatusActivity();
  return (
    <Pane id="build" title="Build" status="In progress" running={rows.some(row => running(row.item))} count={rows.length} right={<BuildLimit building={building} limit={buildLimit && limitNumber(buildLimit)} />}>
      {rows.length ? <Rows rows={rows} /> : <PaneEmpty filtered={build.length > 0} none="Nothing in build.">Nothing in build matches.</PaneEmpty>}
    </Pane>
  );
}
