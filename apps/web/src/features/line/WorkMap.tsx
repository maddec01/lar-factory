// A dossier's map, its current work first: a Decisions lane, a Builds lane for the dossier's own repository and a lane
// for each other repository, named by its project icon and name, parts placed left to right by what they wait on, arrows between them, ending in the end-to-end check when one is written. Finished history folds into
// one group below, which every arrow to or from a finished part starts or ends on as a quiet rail, labelled with how many parts it stands for
// and naming them on hover and focus. Every card is as tall as the tallest needs, at least a three-line title's room.

import { itemName, ref } from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { useId, useState } from 'react';

import { CompactWorkMap } from './CompactWorkMap';
import { isDone, isHistory, upstreamOf } from './DossierParts';
import type { Part } from './DossierParts';
import { ItemCard } from './ItemCard';
import { useWidth } from './useWidth';
import {
    DECISIONS,
    GROUP_H,
    HISTORY,
    LABEL_W,
    PREREQUISITES,
    busLine,
    edgeLine,
    historyText,
    keyOf,
    layout,
} from './WorkMapLayout';
import { CheckNode, HistoryRow, MapRepo } from './WorkMapParts';
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

    const m = layout(parts, data, width, Boolean(check), { home });
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
    // The group's line, which every rail rises from or ends on; lit with them while the group is hovered.
    const railEnds = m.edges
        .filter((e) => e.from === HISTORY || e.to === HISTORY)
        .map((e) => ({ from: at.get(e.from), to: at.get(e.to) }));
    const busD = busLine(m, railEnds);
    const lanesEnd = m.bands.reduce((end, b) => Math.max(end, b.top + b.height), 0);
    const bus = busD
        ? [
              {
                  key: 'bus',
                  d: busD,
                  done: true,
                  lit: hover === HISTORY,
                  dim: !!hover && hover !== HISTORY,
                  rail: true,
                  bare: true,
              },
          ]
        : [];

    return (
        <WorkMapFrame frameRef={box} labelWidth={compact ? 0 : LABEL_W}>
            {compact && <CompactWorkMap map={m} width={width} check={check} data={data} />}
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
                            ) : (
                                <MapRepo repo={b.lane} data={data} />
                            )}
                        </MapBand>
                    ))}
                {!compact && history.length > 0 && (
                    // The lane names' column runs on under the history group, so what scrolls under it there hides
                    // too; the group's toggle stays over it.
                    <MapBand index={0} top={lanesEnd} height={m.height - lanesEnd} width={m.width} labelWidth={LABEL_W}>
                        {null}
                    </MapBand>
                )}
                {!compact && (
                    <MapEdges
                        width={m.width}
                        height={m.height}
                        markerId={marker}
                        edges={[
                            ...m.edges.flatMap((e) => {
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
                            }),
                            ...bus,
                        ]}
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
                                <ItemCard
                                    item={p.part.item}
                                    part={p.part}
                                    data={data}
                                    width={m.nodeW}
                                    height={m.nodeH}
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
                        <HistoryRow key={keyOf(p)} part={p} after={ups(p).filter(isHistory)} data={data} />
                    ))}
                </MapHistoryList>
            )}
        </WorkMapFrame>
    );
}
