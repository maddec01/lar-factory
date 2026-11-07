// The work map's layout: which lane and column each part takes, the arrows between them with the history group in
// place of each finished part, and each arrow's line.

import { itemName, needsAnswer, plural, repoKey } from '@lar-factory/shared';
import type { BoardData } from '@lar-factory/shared';

import { DECISION_KINDS, isHistory, partActivity, partWaves, upstreamOf } from './DossierParts';
import type { Part } from './DossierParts';
import { startable } from './PartStart';
import { YOURS } from './StageTrack';

const DECISIONS = 'Decisions';
const CHECK = 'e2e';
const HISTORY = 'history';
/** A part's work ID, which ticketless parts have too. */
const keyOf = (p: Part) => p.item.id;

const LABEL_W = 116;
const NODE_H = 104;
const GAP = 20;
const PAD = 18;
const MIN_COL = 268;
const MAX_COL = 340;
/** The history group's height, and the room above and below it. */
const GROUP_H = 36;
const GROUP_PAD = 8;

export { DECISIONS, GROUP_H, HISTORY, LABEL_W, NODE_H, keyOf };

export interface Placed {
    key: string;
    part: Part | null;
    col: number;
    x: number;
    y: number;
}
interface Edge {
    from: string;
    to: string;
    label?: string;
    names?: string;
}

/** What leads a lane or a column: a question, then work on your desk, then running work, then what can start. */
function urgency(p: Part): number {
    if (needsAnswer(p.item)) return 0;

    if (partActivity(p).kind === 'working') return 2;

    if (YOURS.includes(p.item.status)) return 1;

    return startable(p) ? 3 : 4;
}

/** The arrows among `parts` with the history group in place of each finished part, one per pair, counting the parts it stands for. */
function edgesOf(parts: Part[], check: boolean): Edge[] {
    const ups = upstreamOf(parts);
    const shownKey = (p: Part) => (isHistory(p) ? HISTORY : keyOf(p));
    const pairs = parts.flatMap((p) =>
        ups(p).map((u) => ({ from: shownKey(u), to: shownKey(p), via: isHistory(u) ? u : p })),
    );

    if (check) {
        // The check waits on every build; arrows come only from the last ones, the rest it waits on through them.
        const sinks = parts.filter((p) => !parts.some((u) => ups(u).includes(p)));
        const ends = sinks.filter((p) => p.kind === 'build');

        pairs.push(...(ends.length ? ends : sinks).map((p) => ({ from: shownKey(p), to: CHECK, via: p })));
    }

    const edges = new Map<string, { from: string; to: string; via: Set<Part> }>();

    for (const { from, to, via } of pairs) {
        if (from === HISTORY && to === HISTORY) continue;

        const edge = edges.get(`${from} ${to}`) ?? { from, to, via: new Set<Part>() };

        edge.via.add(via);
        edges.set(`${from} ${to}`, edge);
    }

    return [...edges.values()].map(({ from, to, via }) => {
        const names = [...via].map((p) => itemName(p.item)).join(', ');

        if (from === HISTORY) return { from, to, label: plural(via.size, 'completed prerequisite'), names };

        return to === HISTORY
            ? { from, to, label: `before ${plural(via.size, 'completed part')}`, names }
            : { from, to };
    });
}

export function layout(parts: Part[], data: BoardData, width: number, check: boolean) {
    const current = parts.filter((p) => !isHistory(p));
    const depth = partWaves(current);
    const laneOf = (p: Part) => (DECISION_KINDS.includes(p.kind) ? DECISIONS : repoKey(p.item));
    const named = [DECISIONS, ...data.repos.map((r) => r.repo), ...current.map(laneOf)];
    const first = (lane: string) => Math.min(...current.filter((p) => laneOf(p) === lane).map(urgency));
    const lanes = [...new Set(named)]
        .filter((l) => current.some((p) => laneOf(p) === l))
        .sort((a, b) => first(a) - first(b));
    const cols = Math.max(1, Math.max(-1, ...depth.values()) + 1 + (check ? 1 : 0));
    const colW = Math.min(MAX_COL, Math.max(MIN_COL, Math.floor((width - LABEL_W) / cols)));
    const nodeW = colW - 28;
    const placed: Placed[] = [];
    const bands: { lane: string; top: number; height: number }[] = [];
    let top = 0;

    lanes.forEach((lane) => {
        const here = current.filter((p) => laneOf(p) === lane);
        const inCol = (c: number) =>
            here.filter((p) => depth.get(keyOf(p)) === c).sort((a, b) => urgency(a) - urgency(b));
        const rows = Math.max(1, ...Array.from({ length: cols }, (_, c) => inCol(c).length));

        for (let c = 0; c < cols; c++) {
            inCol(c).forEach((p, r) =>
                placed.push({
                    key: keyOf(p),
                    part: p,
                    col: c,
                    x: LABEL_W + c * colW + 14,
                    y: top + PAD + r * (NODE_H + GAP),
                }),
            );
        }

        const height = PAD * 2 + rows * NODE_H + (rows - 1) * GAP;

        bands.push({ lane, top, height });
        top += height;
    });

    const lanesEnd = check ? Math.max(top, PAD * 2 + NODE_H) : top;

    if (check)
        placed.push({
            key: CHECK,
            part: null,
            col: cols - 1,
            x: LABEL_W + (cols - 1) * colW + 14,
            y: lanesEnd / 2 - NODE_H / 2,
        });

    const history = parts.length > current.length;
    const fullWidth = Math.max(LABEL_W + cols * colW, width);

    return {
        placed,
        bands,
        edges: edgesOf(parts, check),
        nodeW,
        colW,
        width: fullWidth,
        groupY: lanesEnd + GROUP_PAD,
        height: lanesEnd + (history ? GROUP_H + GROUP_PAD * 2 : 0),
    };
}

/** An arrow's line; the group's run in the gutter beside a column, so none passes behind a node. */
export function edgeLine(m: ReturnType<typeof layout>, from: Placed | undefined, to: Placed | undefined) {
    if (!from && to) {
        const y = to.y + NODE_H / 2,
            gx = to.x - 14;

        return `M${gx} ${m.groupY} L${gx} ${y + 8} Q${gx} ${y} ${gx + 8} ${y} L${to.x - 2} ${y}`;
    }

    if (from && !to) {
        const y = from.y + NODE_H / 2,
            x = from.x + m.nodeW,
            gx = x + 10;

        return `M${x} ${y} L${gx - 8} ${y} Q${gx} ${y} ${gx} ${y + 8} L${gx} ${m.groupY - 2}`;
    }

    if (!from || !to) return null;

    const x1 = from.x + m.nodeW,
        y1 = from.y + NODE_H / 2,
        x2 = to.x - 2,
        y2 = to.y + NODE_H / 2,
        mid = (x1 + x2) / 2;
    // Over a column, the arrow leaves from the node's foot and runs in the gap under the row, not behind a node.
    const sx = x1 - 20,
        wy = from.y + NODE_H + GAP / 2;

    return to.col - from.col > 1
        ? `M${sx} ${from.y + NODE_H} L${sx} ${wy - 6} Q${sx} ${wy} ${sx + 6} ${wy} L${x2 - 30} ${wy} C${x2 - 12} ${wy} ${x2 - 18} ${y2} ${x2} ${y2}`
        : `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`;
}

/** How the group sums itself up: its settled decisions and finished builds, each left out at zero. */
export const historyText = (parts: Part[]) => {
    const decisions = parts.filter((p) => DECISION_KINDS.includes(p.kind)).length;
    const builds = parts.length - decisions;

    return [decisions && plural(decisions, 'settled decision'), builds && plural(builds, 'finished build')]
        .filter(Boolean)
        .join(' · ');
};
