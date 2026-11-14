// A dossier's map, its current work first: a Decisions lane, a Builds lane for the dossier's own repository and a lane
// for each other repository, named by its project icon and name, parts placed left to right by what they wait on, arrows between them, ending in the end-to-end check when one is written. Finished history folds into
// one group below, which every arrow to or from a finished part starts or ends on, labelled with how many parts it stands for and naming them on hover and focus.

import { ref } from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { useId, useState } from 'react';

import { CompactWorkMap } from './CompactWorkMap';
import { isDone, isHistory, upstreamOf } from './DossierParts';
import type { Part } from './DossierParts';
import { useWidth } from './useWidth';
import {
    DECISIONS,
    GAP,
    GROUP_H,
    HISTORY,
    LABEL_W,
    PREREQUISITES,
    edgeLine,
    historyText,
    keyOf,
    layout,
} from './WorkMapLayout';
import { CheckNode, HistoryRow, PartNode, RepoIdentity } from './WorkMapParts';
import { StatusGlyph } from '@/features/items';
import {
    MapBand,
    MapCanvas,
    MapEdgeLabel,
    MapEdges,
    MapHistoryGroup,
    MapHistoryList,
    MapLaneName,
    MapNode,
    MapPrerequisiteNode,
    WorkMapFrame,
} from '@/ui/board';

/** The map of `parts`, current work first and finished history folded below, ending in `check` when one is written. `home` is the dossier's own repository, which needs no naming. */
export function WorkMap({
    parts,
    check,
    data,
    home,
}: {
    parts: Part[];
    check: EndToEndCheck | undefined;
    data: BoardData;
    home: string;
}) {
    const { ref: box, width } = useWidth();
    const [hover, setHover] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const marker = useId().replace(/[^a-zA-Z0-9]/g, '');

    if (!parts.length && !check) return null;

    const m = layout(parts, data, width, Boolean(check));
    const compact = width > 0 && width < 600;
    const at = new Map(m.placed.map((p) => [p.key, p]));
    const near = (key: string) =>
        !hover ||
        key === hover ||
        m.edges.some((e) => (e.from === hover && e.to === key) || (e.to === hover && e.from === key));
    const builds = parts
        .filter((p) => p.kind === 'build' && !isHistory(p))
        .map((p) => ref(p.item))
        .join(', ')
        .replace(/, ([^,]*)$/, ' and $1');
    const history = parts.filter(isHistory);
    const ups = upstreamOf(parts);

    return (
        <WorkMapFrame frameRef={box}>
            {compact && <CompactWorkMap map={m} width={width} check={check} data={data} home={home} />}
            <MapCanvas
                width={compact ? width : m.width}
                height={compact ? (history.length ? GROUP_H + 16 : 0) : m.height}
            >
                {!compact &&
                    m.bands.map((b, n) => (
                        <MapBand
                            key={b.lane}
                            index={n}
                            top={b.top}
                            height={b.height}
                            width={m.width}
                            labelWidth={LABEL_W}
                        >
                            {b.lane === PREREQUISITES ? (
                                <MapLaneName lane="decisions">Prerequisites</MapLaneName>
                            ) : b.lane === DECISIONS ? (
                                <MapLaneName lane="decisions">{DECISIONS}</MapLaneName>
                            ) : b.lane === home ? (
                                <MapLaneName lane="builds">Builds</MapLaneName>
                            ) : (
                                <RepoIdentity repo={b.lane} data={data} />
                            )}
                        </MapBand>
                    ))}
                {!compact && (
                    <MapEdges
                        width={m.width}
                        height={m.height}
                        markerId={marker}
                        edges={m.edges.flatMap((e) => {
                            const a = at.get(e.from),
                                b = at.get(e.to);
                            const d = edgeLine(m, a, b);

                            if (!d) return [];

                            const lit = !!hover && (e.from === hover || e.to === hover);

                            return [
                                {
                                    key: `${e.from} ${e.to}`,
                                    d,
                                    kind: e.kind,
                                    done:
                                        e.from === HISTORY
                                            ? e.complete !== false
                                            : (!!a?.part && isDone(a.part.item)) ||
                                              a?.prerequisite?.blocker.state === 'closed',
                                    lit,
                                    dim: !!hover && !lit,
                                },
                            ];
                        })}
                    />
                )}
                {!compact &&
                    m.edges.map((e) => {
                        if (!e.label) return null;

                        const to = at.get(e.to),
                            from = at.get(e.from);
                        const place = to
                            ? // In the gap over the node it leads to, 8px from each node.
                              { left: to.x, top: to.y - GAP + 8, width: m.nodeW }
                            : from
                              ? { left: from.x + m.nodeW + 14, top: m.groupY - 15, width: m.colW - 20 }
                              : null;

                        return (
                            place && (
                                <MapEdgeLabel
                                    key={`${e.from}-${e.to}`}
                                    edge={`${e.from} ${e.to}`}
                                    label={e.label}
                                    names={e.names ?? ''}
                                    left={place.left}
                                    top={place.top}
                                    maxWidth={place.width}
                                    onOpen={() => setShowHistory(true)}
                                />
                            )
                        );
                    })}
                {!compact &&
                    m.placed.map((p) => (
                        <MapNode
                            key={p.key}
                            left={p.x}
                            top={p.y}
                            dim={!near(p.key)}
                            onHover={(on) => setHover(on ? p.key : null)}
                        >
                            {p.prerequisite ? (
                                <MapPrerequisiteNode prerequisite={p.prerequisite} width={m.nodeW} />
                            ) : p.part ? (
                                <PartNode part={p.part} data={data} width={m.nodeW} home={home} />
                            ) : (
                                check && <CheckNode check={check} width={m.nodeW} after={builds} />
                            )}
                        </MapNode>
                    ))}
                {history.length > 0 && (
                    <MapHistoryGroup
                        open={showHistory}
                        top={compact ? 8 : m.groupY}
                        height={GROUP_H}
                        dim={!near(HISTORY)}
                        glyph={<StatusGlyph status="Done" />}
                        text={historyText(history)}
                        showLabel="Show"
                        hideLabel="Hide"
                        onToggle={() => setShowHistory(!showHistory)}
                        onHover={(on) => setHover(on ? HISTORY : null)}
                    />
                )}
            </MapCanvas>
            {showHistory && (
                <MapHistoryList>
                    {history.map((p) => (
                        <HistoryRow key={keyOf(p)} part={p} after={ups(p).filter(isHistory)} data={data} home={home} />
                    ))}
                </MapHistoryList>
            )}
        </WorkMapFrame>
    );
}
