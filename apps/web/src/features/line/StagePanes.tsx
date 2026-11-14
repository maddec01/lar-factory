// The Shaping, Ready to build and Build sections. Ready to build's header holds the Auto-build switch, and Build's counts the
// factory's builds at work against the build limit.

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
                <ReadyBuildControls>
                    <BuildLimit />
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
            building={builds.items.length}
            limit={builds.limit}
            title={`${builds.text}. ${BUILD_LIMIT_NOTE} All builds count toward this limit. At capacity, Pedro can start an item over the limit; automatic starts wait for a slot.`}
        >
            {builds.occupancy}
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
