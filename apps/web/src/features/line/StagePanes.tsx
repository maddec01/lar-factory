// The Shaping, Ready to build and Build sections. Ready to build's header holds the Auto-build switch, and Build's counts the
// factory's builds at work against the build limit. An item on Your desk stays in its lane too, in its place there with
// a softer light, so each lane shows everything at its stage and nothing jumps as work starts or stops waiting on you.

import { AutoBuildSwitch } from './AutoBuildSwitch';
import { Pane, PaneEmpty } from './Pane';
import { StageRow } from './StageRow';
import type { StageRow as Row } from './StageRows';
import { useBuilds, useStatusActivity, BUILD_LIMIT_NOTE } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { BuildLimit as DesignBuildLimit, ReadyBuildControls, StageList } from '@/ui/board';

type Shows = (row: Row) => boolean;

function Rows({ rows }: { rows: Row[] }) {
    const data = useBoardStore((state) => state.data);

    // Every row in its lane's own order, those on Your desk too, never folded or moved: a row that starts or stops
    // waiting on you changes its light, not its place, so the lane doesn't jump.
    return (
        <StageList>
            {rows.map((row) => (
                <StageRow key={row.item.id} row={row} data={data} />
            ))}
        </StageList>
    );
}

export function Shaping({ shaping, shows }: { shaping: Row[]; shows: Shows }) {
    const rows = shaping.filter(shows);

    return (
        <Pane
            id="shaping"
            title="Shaping"
            status="Shaping"
            count={rows.length}
            empty={
                !rows.length && (
                    <PaneEmpty filtered={shaping.length > 0} none="Nothing in shaping.">
                        Nothing in shaping matches.
                    </PaneEmpty>
                )
            }
        >
            <Rows rows={rows} />
        </Pane>
    );
}

export function ReadyToBuild({ ready, shows }: { ready: Row[]; shows: Shows }) {
    const rows = ready.filter(shows);

    return (
        <Pane
            id="ready"
            title="Ready to build"
            status="Ready"
            count={rows.length}
            right={
                // Build's header carries the shared occupancy; Ready keeps only what starts builds.
                <ReadyBuildControls>
                    <AutoBuildSwitch />
                </ReadyBuildControls>
            }
            empty={
                !rows.length && (
                    <PaneEmpty filtered={ready.length > 0} none="Nothing ready to build.">
                        Nothing ready to build matches.
                    </PaneEmpty>
                )
            }
        >
            <Rows rows={rows} />
        </Pane>
    );
}

/** Builds at work against the build limit, one bar per build it allows, more when they're over it, counted by the
 *  words their rows say. */
function BuildLimit() {
    const builds = useBuilds();

    return (
        <DesignBuildLimit
            over={builds.limit === undefined ? 0 : Math.max(0, builds.items.length - builds.limit)}
            building={builds.items.length}
            limit={builds.limit}
            title={`${builds.text}. ${BUILD_LIMIT_NOTE} At capacity, you can start an item over the limit; automatic starts wait for a slot.`}
        >
            {builds.limit !== undefined && builds.items.length > builds.limit
                ? `${builds.items.length} building${builds.waiting.length ? ` · ${builds.waiting.length} waiting on their PR` : ''}`
                : builds.occupancy}
        </DesignBuildLimit>
    );
}

export function Build({ build, shows }: { build: Row[]; shows: Shows }) {
    const rows = build.filter(shows);
    const running = useStatusActivity();

    return (
        <Pane
            id="build"
            title="Build"
            status="In progress"
            running={rows.some((row) => running(row.item))}
            count={rows.length}
            right={<BuildLimit />}
            empty={
                !rows.length && (
                    <PaneEmpty filtered={build.length > 0} none="Nothing in build.">
                        Nothing in build matches.
                    </PaneEmpty>
                )
            }
        >
            <Rows rows={rows} />
        </Pane>
    );
}
