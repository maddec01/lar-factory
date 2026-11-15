// A dossier's map, its current work first: a Decisions lane, a Builds lane for the dossier's own repository and a lane
// for each other repository, named by its project icon and name, parts placed left to right by what they wait on, arrows between them, ending in the end-to-end check when one is written. Finished history folds into
// one group below, which every arrow to or from a finished part starts or ends on as a quiet rail, labelled with how many parts it stands for
// and naming them on hover and focus. Every card is as tall as the tallest needs, at least a three-line title's room.

import { itemName, ref } from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { useId, useLayoutEffect, useState } from 'react';

import { CompactWorkMap } from './CompactWorkMap';
import { isDone, isHistory, upstreamOf } from './DossierParts';
import type { Part } from './DossierParts';
import { useWidth } from './useWidth';
import {
    DECISIONS,
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
    MAP_NODE_HEIGHT,
    measureMapCards,
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
    const [nodeH, setNodeH] = useState(MAP_NODE_HEIGHT);

    // Every card takes the height its tallest needs, measured before the map paints, so their edges line up with no
    // empty band in a short one; a change in what a card says measures again.
    useLayoutEffect(() => {
        const needed = measureMapCards(box.current);

        // oxlint-disable-next-line react/set-state-in-effect -- the cards' height is read from the laid-out DOM, before paint
        if (needed !== nodeH) setNodeH(needed);
    }, [box, parts, check, data, width, nodeH]);

    if (!parts.length && !check) return null;

    const m = layout(parts, data, width, Boolean(check), { home, nodeH });
    const compact = width > 0 && width < 600;
    const at = new Map(m.placed.map((p) => [p.key, p]));
    // The nodes an arrow joins to the hovered one, which take a stronger edge; the hovered one keeps its own hover.
    const related = (key: string) =>
        !!hover &&
        key !== hover &&
        m.edges.some((e) => (e.from === hover && e.to === key) || (e.to === hover && e.from === key));
    // What finished work each node follows or comes before, also in its tooltip beside its rail's label.
    const followed = new Map<string, string>();

    for (const e of m.edges) {
        const [key, said] = e.from === HISTORY ? [e.to, `After ${e.label}`] : [e.from, e.label];

        if (e.label && (e.from === HISTORY || e.to === HISTORY))
            followed.set(key, [followed.get(key), `${said}: ${e.names}`].filter(Boolean).join(' · '));
    }

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
                snap={compact ? undefined : { step: m.colW, count: m.cols }}
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
                                    rail: e.from === HISTORY || e.to === HISTORY,
                                },
                            ];
                        })}
                    />
                )}
                {!compact &&
                    m.labels.map(({ edge, left, top, maxWidth }) => (
                        <MapEdgeLabel
                            key={`${edge.from}-${edge.to}`}
                            edge={`${edge.from} ${edge.to}`}
                            label={edge.label!}
                            names={edge.names ?? ''}
                            left={left}
                            top={top}
                            maxWidth={maxWidth}
                            onOpen={() => setShowHistory(true)}
                        />
                    ))}
                {!compact &&
                    m.placed.map((p) => (
                        <MapNode
                            key={p.key}
                            name={
                                p.part
                                    ? itemName(p.part.item)
                                    : (p.prerequisite?.title ?? (check ? `Outcome check: ${check.title}` : ''))
                            }
                            left={p.x}
                            top={p.y}
                            related={related(p.key)}
                            onHover={(on) => setHover(on ? p.key : null)}
                        >
                            {p.prerequisite ? (
                                <MapPrerequisiteNode prerequisite={p.prerequisite} width={m.nodeW} height={m.nodeH} />
                            ) : p.part ? (
                                <PartNode
                                    part={p.part}
                                    data={data}
                                    width={m.nodeW}
                                    height={m.nodeH}
                                    home={home}
                                    history={followed.get(p.key)}
                                />
                            ) : (
                                check && <CheckNode check={check} width={m.nodeW} height={m.nodeH} after={builds} />
                            )}
                        </MapNode>
                    ))}
                {history.length > 0 && (
                    <MapHistoryGroup
                        open={showHistory}
                        top={compact ? 8 : m.groupY}
                        height={GROUP_H}
                        onToggle={() => setShowHistory(!showHistory)}
                        glyph={<StatusGlyph status="Done" size="sm" />}
                        onHover={(on) => setHover(on ? HISTORY : null)}
                    >
                        {historyText(history)}
                    </MapHistoryGroup>
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
