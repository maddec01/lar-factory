// The Shaping, Ready to build and Build sections. Ready to build's header holds the Auto-build switch, and Build's counts the
// factory's builds at work against the build limit.

import { activityUnavailable, buildsAtWork, limitNumber } from '@lar-factory/shared';
import { BuildLimit as DesignBuildLimit, StageList } from '@lar-works/design-system';

import { AutoBuildSwitch } from './AutoBuildSwitch';
import { Pane, PaneEmpty } from './Pane';
import { StageRow } from './StageRow';
import type { StageRow as Row } from './StageRows';
import { STATUS_COLOR, useStatusActivity } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';

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
        <Pane id="shaping" title="Shaping" status="Shaping" count={rows.length}>
            {rows.length ? (
                <Rows rows={rows} />
            ) : (
                <PaneEmpty filtered={shaping.length > 0} none="Nothing in shaping.">
                    Nothing in shaping matches.
                </PaneEmpty>
            )}
        </Pane>
    );
}

export function ReadyToBuild({ ready, shows }: { ready: Row[]; shows: Shows }) {
    const rows = ready.filter(shows);

    return (
        <Pane id="ready" title="Ready to build" status="Ready" count={rows.length} right={<AutoBuildSwitch />}>
            {rows.length ? (
                <Rows rows={rows} />
            ) : (
                <PaneEmpty filtered={ready.length > 0} none="Nothing ready to build.">
                    Nothing ready to build matches.
                </PaneEmpty>
            )}
        </Pane>
    );
}

/** Builds at work against the build limit, one bar per build it allows, more when they're over it. */
function BuildLimit({ building, limit }: { building: number; limit: number | undefined }) {
    return (
        <DesignBuildLimit
            building={building}
            limit={limit}
            color={STATUS_COLOR['In progress']}
            title="Builds at work against the build limit"
        >
            {`${building}${limit !== undefined ? `/${limit}` : ''} building`}
        </DesignBuildLimit>
    );
}

export function Build({ build, shows }: { build: Row[]; shows: Shows }) {
    const building = useBoardStore(
        (state) => buildsAtWork(state.data, activityUnavailable(state.data, state.now, state.clientError)).length,
    );
    const buildLimit = useBoardStore((state) => state.data.buildLimit);
    const rows = build.filter(shows);
    const running = useStatusActivity();

    return (
        <Pane
            id="build"
            title="Build"
            status="In progress"
            running={rows.some((row) => running(row.item))}
            count={rows.length}
            right={<BuildLimit building={building} limit={buildLimit && limitNumber(buildLimit)} />}
        >
            {rows.length ? (
                <Rows rows={rows} />
            ) : (
                <PaneEmpty filtered={build.length > 0} none="Nothing in build.">
                    Nothing in build matches.
                </PaneEmpty>
            )}
        </Pane>
    );
}
