// The work map's layout: which lane and column each part takes, the arrows between them with the history group in
// place of each finished part, and each arrow's line.

import type { BoardData, WorkMapPrerequisite } from '@lar-factory/shared';
import { itemName, plural, projectWorkMap, repoKey } from '@lar-factory/shared';

import type { Part } from './DossierParts';
import { DECISION_KINDS, isHistory, partWaves, upstreamOf } from './DossierParts';
import { MAP_NODE_HEIGHT, MAP_NODE_WIDTH } from '@/ui/board';

const DECISIONS = 'Decisions';
const CHECK = 'e2e';
const PREREQUISITES = 'Prerequisites';
const HISTORY = 'history';
/** A part's work ID, which ticketless parts have too. */
const keyOf = (p: Part) => p.item.id;

const LABEL_W = 116;
/** The cards' size, a desk card's on every screen. */
const NODE_H = MAP_NODE_HEIGHT;
/** The room between two nodes in a column, where an arrow over a column runs. */
const GAP = 24;
/** The room above a lane's first row and below its last: the lane fits its cards closely. */
const PAD = 12;
const TOP = PAD;
/** A column's gutter each side of its card. */
const GUTTER = 14;
/** The history toggle's line, and the room above and below it. */
const GROUP_H = 28;
const GROUP_PAD = 8;
/** An arrow label's line ("2 completed prerequisites"), and the room below it, so it sits in a gap of its own; a lane
 *  whose cards take one keeps its PAD above it too, so the label never sits tight under the frame or the lane's rule. */
const EDGE_LABEL_H = 16;
const EDGE_LABEL_ROOM = EDGE_LABEL_H + 6;

export { DECISIONS, GROUP_H, HISTORY, keyOf, LABEL_W, PREREQUISITES };

export interface Placed {
    key: string;
    part: Part | null;
    prerequisite?: WorkMapPrerequisite;
    col: number;
    x: number;
    y: number;
}
interface Edge {
    from: string;
    to: string;
    label?: string;
    names?: string;
    kind?: 'blocker' | 'dependency';
    /** A rail from the history group: false while one of the parts it stands for was set aside, not completed. */
    complete?: boolean;
}

/** The arrows among `parts` with the history group in place of each finished part, one per pair, counting the parts it stands for. */
function edgesOf(parts: Part[], check: boolean): Edge[] {
    const ups = upstreamOf(parts);
    const shownKey = (p: Part) => (isHistory(p) ? HISTORY : keyOf(p));
    const graph = projectWorkMap(parts.map((p) => p.item));
    const byId = new Map(parts.map((p) => [p.item.id, p]));
    const pairs = graph.edges.map((edge) => ({
        from: byId.has(edge.from) ? shownKey(byId.get(edge.from)!) : edge.from,
        to: shownKey(byId.get(edge.to)!),
        kind: edge.kind,
        via: byId.get(edge.from) && isHistory(byId.get(edge.from)!) ? byId.get(edge.from)! : byId.get(edge.to)!,
    }));

    if (check) {
        // The check waits on every build; arrows come only from the last ones, the rest it waits on through them.
        const sinks = parts.filter((p) => !parts.some((u) => ups(u).includes(p)));
        const ends = sinks.filter((p) => p.kind === 'build');

        pairs.push(
            ...(ends.length ? ends : sinks).map((p) => ({
                from: shownKey(p),
                to: CHECK,
                kind: 'blocker' as const,
                via: p,
            })),
        );
    }

    const edges = new Map<string, { from: string; to: string; kind: 'blocker' | 'dependency'; via: Set<Part> }>();

    for (const { from, to, via, kind } of pairs) {
        if (from === HISTORY && to === HISTORY) continue;

        const edge = edges.get(`${from} ${to}`) ?? { from, to, kind, via: new Set<Part>() };

        edge.via.add(via);
        edges.set(`${from} ${to}`, edge);
    }

    return [...edges.values()].map(({ from, to, via, kind }) => {
        const names = [...via].map((p) => itemName(p.item)).join(', ');
        const retired = [...via].some((part) => part.item.setAside);

        if (from === HISTORY) {
            return {
                from,
                to,
                kind,
                complete: !retired,
                label: plural(via.size, retired ? 'past prerequisite' : 'completed prerequisite'),
                names,
            };
        }

        return to === HISTORY
            ? { from, to, kind, label: `before ${plural(via.size, retired ? 'past part' : 'completed part')}`, names }
            : { from, to, kind };
    });
}

/**
 * Where everything sits on a map `width` wide whose cards are `nodeH` tall: the project lanes first, the dossier's own
 * (`home`) leading, then the other projects in the board's order, then Decisions, so every map reads the same way.
 * A lane whose first-row card takes an arrow label from the history group starts lower, so the label sits in a gap of
 * its own; labels of arrows into the group take a line above it, one per column.
 */
export function layout(
    parts: Part[],
    data: BoardData,
    width: number,
    check: boolean,
    { home = '', nodeH = NODE_H }: { home?: string; nodeH?: number } = {},
) {
    const graph = projectWorkMap(parts.map((p) => p.item));
    const offset = graph.prerequisites.length ? 1 : 0;
    const current = parts.filter((p) => !isHistory(p));
    const depth = partWaves(current);
    const laneOf = (p: Part) => (DECISION_KINDS.includes(p.kind) ? DECISIONS : repoKey(p.item));
    const named = [home, ...data.repos.map((r) => r.repo), ...current.map(laneOf), DECISIONS];
    const lanes = [...new Set(named.filter((lane) => lane !== DECISIONS)), DECISIONS].filter((l) =>
        current.some((p) => laneOf(p) === l),
    );
    const edges = edgesOf(parts, check);
    const labelledFrom = new Set(edges.filter((e) => e.from === HISTORY && e.label).map((e) => e.to));
    const cols = Math.max(1, Math.max(-1, ...depth.values()) + 1 + offset + (check ? 1 : 0));
    // Every column holds a desk-sized card whatever the frame's width: a wider frame leaves room after the last column,
    // a narrower one scrolls sideways.
    const nodeW = MAP_NODE_WIDTH;
    const colW = nodeW + 2 * GUTTER;
    const placed: Placed[] = [];
    const bands: { lane: string; top: number; height: number }[] = [];
    let top = 0;

    if (offset) {
        graph.prerequisites.forEach((prerequisite, row) =>
            placed.push({
                key: prerequisite.id,
                part: null,
                prerequisite,
                col: 0,
                x: LABEL_W + GUTTER,
                y: TOP + row * (nodeH + GAP),
            }),
        );
        top = TOP + PAD + graph.prerequisites.length * nodeH + (graph.prerequisites.length - 1) * GAP;
        bands.push({ lane: PREREQUISITES, top: 0, height: top });
    }

    // The end-to-end check sits in the first lane's first row, in the last column, inside a lane rather than across
    // the rule between two; its rail's label takes the lane's lead room as a card's would.
    let checkY = TOP;

    lanes.forEach((lane, index) => {
        const here = current.filter((p) => laneOf(p) === lane);
        const inCol = (c: number) => here.filter((p) => depth.get(keyOf(p))! + offset === c);
        const rows = Math.max(1, ...Array.from({ length: cols }, (_, c) => inCol(c).length));
        const first = Array.from({ length: cols }, (_, c) => inCol(c)[0]).filter(Boolean);
        const checkHere = check && index === 0;
        const lead =
            first.some((p) => labelledFrom.has(keyOf(p!))) || (checkHere && labelledFrom.has(CHECK))
                ? TOP + EDGE_LABEL_ROOM
                : TOP;

        if (checkHere) checkY = top + lead;

        for (let c = 0; c < cols; c++) {
            inCol(c).forEach((p, r) =>
                placed.push({
                    key: keyOf(p),
                    part: p,
                    col: c,
                    x: LABEL_W + c * colW + GUTTER,
                    y: top + lead + r * (nodeH + GAP),
                }),
            );
        }

        const height = lead + PAD + rows * nodeH + (rows - 1) * GAP;

        bands.push({ lane, top, height });
        top += height;
    });

    const lanesEnd = check ? Math.max(top, checkY + PAD + nodeH) : top;

    if (check)
        placed.push({
            key: CHECK,
            part: null,
            col: cols - 1,
            x: LABEL_W + (cols - 1) * colW + GUTTER,
            y: checkY,
        });

    // Arrows into the group carry their label just above it, in the column after their card; two in one column stack.
    const at = new Map(placed.map((p) => [p.key, p]));
    const intoGroup = new Map<number, number>();
    const labels = edges.flatMap((e) => {
        if (!e.label) return [];

        if (e.from === HISTORY) {
            const to = at.get(e.to);

            return to ? [{ edge: e, left: to.x, top: to.y - EDGE_LABEL_ROOM + 2, maxWidth: nodeW }] : [];
        }

        const from = at.get(e.from);

        if (!from) return [];

        const line = intoGroup.get(from.col) ?? 0;

        intoGroup.set(from.col, line + 1);

        return [{ edge: e, left: from.x + nodeW + 16, top: line, maxWidth: colW - 24 }];
    });
    const groupLines = Math.max(0, ...intoGroup.values());
    const groupY = lanesEnd + GROUP_PAD + groupLines * EDGE_LABEL_ROOM;
    const history = parts.length > current.length;
    const drawn = LABEL_W + cols * colW;
    // Wider than the frame, the map scrolls by whole columns to its end, so the last stop shows whole cards from the
    // lane names on, never a sliver of one under them.
    const fullWidth = drawn > width ? width + Math.ceil((drawn - width) / colW) * colW : Math.max(drawn, width);

    return {
        placed,
        bands,
        cols,
        edges,
        // A label into the group counts its line from the group up.
        labels: labels.map((l) =>
            l.edge.from === HISTORY ? l : { ...l, top: groupY - GROUP_PAD - (l.top + 1) * EDGE_LABEL_ROOM + 4 },
        ),
        nodeW,
        nodeH,
        colW,
        width: fullWidth,
        groupY,
        /** The history group's line, which every rail starts or ends on. */
        busY: groupY + GROUP_H / 2,
        height: groupY - GROUP_PAD + (history ? GROUP_H + GROUP_PAD * 2 : 0),
    };
}

/** How far a rail into a card runs in the gutter before it, and a rail out of one in the gutter after it: apart, so two
 *  never run on one line. */
const RAIL_IN = 8;
const RAIL_OUT = 8;

/** The history group's line: from the lane names' edge, under the group's toggle, to the last rail, so every rail
 *  rises from it or ends on it, never in empty space; none when no rail joins the group. */
export function busLine(m: ReturnType<typeof layout>, rails: { from?: Placed | undefined; to?: Placed | undefined }[]) {
    const xs = rails.flatMap(({ from, to }) =>
        to && !from ? [to.x - RAIL_IN] : from && !to ? [from.x + m.nodeW + RAIL_OUT] : [],
    );

    if (!xs.length) return null;

    const end = Math.max(...xs);

    return `M${LABEL_W} ${m.busY} L${end - 8} ${m.busY}`;
}

/** An arrow's line between two placed nodes, or a history rail: up from the group's line (busLine) in the gutter
 *  before the card it leads to, turning into the card's middle, or from a card's end down the gutter after it onto the
 *  group's line, turning along it, so every rail joins the group and none passes behind a node. */
export function edgeLine(m: ReturnType<typeof layout>, from: Placed | undefined, to: Placed | undefined) {
    const h = m.nodeH;
    const bus = m.busY;

    if (!from && to) {
        const y = to.y + h / 2,
            gx = to.x - RAIL_IN;

        return `M${gx - 8} ${bus} Q${gx} ${bus} ${gx} ${bus - 8} L${gx} ${y + 6} Q${gx} ${y} ${gx + 6} ${y} L${to.x - 2} ${y}`;
    }

    if (from && !to) {
        const y = from.y + h / 2,
            x = from.x + m.nodeW,
            gx = x + RAIL_OUT;

        return `M${x} ${y} L${gx - 6} ${y} Q${gx} ${y} ${gx} ${y + 6} L${gx} ${bus - 8} Q${gx} ${bus} ${gx - 8} ${bus}`;
    }

    if (!from || !to) return null;

    const x1 = from.x + m.nodeW,
        y1 = from.y + h / 2,
        x2 = to.x - 2,
        y2 = to.y + h / 2,
        mid = (x1 + x2) / 2;
    // Over a column, the arrow leaves from the node's foot and runs in the gap under the row, not behind a node.
    const sx = x1 - 20,
        wy = from.y + h + GAP / 2;

    return to.col - from.col > 1
        ? `M${sx} ${from.y + h} L${sx} ${wy - 6} Q${sx} ${wy} ${sx + 6} ${wy} L${x2 - 30} ${wy} C${x2 - 12} ${wy} ${x2 - 18} ${y2} ${x2} ${y2}`
        : `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

/** How the group sums itself up: its settled decisions, its finished builds and the parts set aside, each left out at
 *  zero. */
export const historyText = (parts: Part[]) => {
    const setAside = parts.filter((p) => p.item.setAside).length;
    const decisions = parts.filter((p) => !p.item.setAside && DECISION_KINDS.includes(p.kind)).length;
    const builds = parts.length - decisions - setAside;

    return [
        decisions && plural(decisions, 'settled decision'),
        builds && plural(builds, 'finished build'),
        setAside && `${setAside} set aside`,
    ]
        .filter(Boolean)
        .join(' · ');
};
