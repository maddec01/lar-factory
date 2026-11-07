// A dossier's map, its current work first: a Decisions lane, a Builds lane for the dossier's own repository and a lane
// for each other repository, named by its project icon and name, parts placed left to right by what they wait on, arrows between them, ending in the end-to-end check when one is written. Finished history folds into
// one group below, which every arrow to or from a finished part starts or ends on, labelled with how many parts it stands for and naming them on hover and focus.

import {
    buildActivity,
    itemName,
    needsAnswer,
    openQuestionThread,
    plural,
    prLabel,
    ref,
    repoKey,
    repoName,
} from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import {
    BookOpen,
    ChevronDown,
    ChevronRight,
    FlaskConical,
    GitPullRequest,
    Hammer,
    ListChecks,
    Lightbulb,
    MessagesSquare,
    Shapes,
} from '@lar-works/design-system/icons';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
    DECISION_KINDS,
    isDone,
    isHistory,
    openWaits,
    partActivity,
    partLabel,
    partWaves,
    threadsOf,
    upstreamOf,
    waitText,
} from './DossierParts';
import type { Part, PartActivity, PartKind } from './DossierParts';
import { PartStart, startable } from './PartStart';
import { YOURS, lastSeen } from './StageTrack';
import { useItemDialogStore } from '@/features/item-dialog/ItemDialogStore';
import { AzureFields, ItemTitle, SliceBar, useActivityUnavailable, useShownStatus } from '@/features/items/ItemParts';
import { OpenThread } from '@/features/items/OpenThread';
import { SourceIcon } from '@/features/items/SourceIcon';
import { ItemStatusGlyph, StatusGlyph } from '@/features/items/StatusGlyph';
import { ProjectIcon } from '@/features/repositories/ProjectIcon';

const DECISIONS = 'Decisions';
const KIND_ICON: Record<PartKind, typeof Hammer> = {
    grill: MessagesSquare,
    prototype: Shapes,
    research: BookOpen,
    task: ListChecks,
    decision: MessagesSquare,
    build: Hammer,
};
const CHECK = 'e2e';
const HISTORY = 'history';
/** A part's work ID, which ticketless parts have too. */
const keyOf = (p: Part) => p.item.id;
const pickedRing = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--card)' : '');

const LABEL_W = 116;
const NODE_H = 104;
const GAP = 20;
const PAD = 18;
const MIN_COL = 268;
const MAX_COL = 340;
/** The history group's height, and the room above and below it. */
const GROUP_H = 36;
const GROUP_PAD = 8;

interface Placed {
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

function layout(parts: Part[], data: BoardData, width: number, check: boolean) {
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

function useWidth() {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const el = ref.current;

        if (!el) return;

        const observer = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));

        observer.observe(el);

        return () => observer.disconnect();
    }, []);

    return { ref, width };
}

/** A part's method or kind, in the one place and style every map surface shows it. */
export function PartKindLabel({ kind }: { kind: PartKind }) {
    const Icon = KIND_ICON[kind];

    return (
        <span
            className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-(--muted-foreground)"
            data-part-kind
        >
            <Icon className="size-3.5 shrink-0" />
            {partLabel(kind)}
        </span>
    );
}

/** Another repository's identity, its project icon and name together; the corner's source icon says where the ticket lives instead. */
function RepoIdentity({ repo, data }: { repo: string; data: BoardData }) {
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5" title={repo} data-part-repo>
            <ProjectIcon repo={repo} size="small" />
            <span className="truncate">{repoName(repo, data.repos)}</span>
        </span>
    );
}

const ACTIVITY_WORD: Record<PartActivity['kind'], string | null> = {
    'needs you': 'Needs you',
    working: 'Working',
    'child waiting': 'Child waiting',
    stopped: 'Run stopped',
    finished: 'Run finished',
    none: null,
};
/** The statuses where a finished run is news: work it should still be doing. */
const RUNS: string[] = ['Shaping', 'In progress', 'Review'];

/** What runs below a part now, and any slice held up: its active slices, else its child or background work. */
function partDetail({ item }: Part, { kind, thread }: PartActivity): string[] {
    const active = item.slices.filter((s) => s.progress === 'active').length;
    const blocked = item.slices.filter((s) => s.progress === 'blocked').length;

    return [
        ...(active
            ? [`${plural(active, 'slice')} active`]
            : kind === 'working' && thread?.hasRunningChildren
              ? ['child work running']
              : []),
        ...(blocked ? [`${plural(blocked, 'slice')} blocked`] : []),
    ];
}

function PartNode({ part, data, width, home }: { part: Part; data: BoardData; width: number; home: string }) {
    const { item } = part;
    const isPicked = useItemDialogStore((state) => state.itemId === item.id);
    const open = openWaits(part);
    const complete = isDone(item);
    const shown = useShownStatus(item);
    const unavailable = useActivityUnavailable();
    const activity = partActivity(part, shown.working, unavailable);
    const asks = needsAnswer(item);
    const tone = asks
        ? 'border-[color-mix(in_srgb,var(--warning)_45%,var(--border))] shadow-[inset_3px_0_0_var(--warning)]'
        : open.length
          ? 'border-dashed border-(--input)'
          : 'border-(--border)';
    let action: ReactNode = null;

    if (complete) action = null;
    else if (asks)
        action = <OpenThread item={item} data={data} threadId={openQuestionThread(item)?.id} label="Answer in T3" />;
    else if (item.status === 'Ready' || item.status === 'Queued')
        action = <PartStart part={part} data={data} label="Start" namesBlocker={false} />;

    // Open thread joins anything but the card's own Start or answer, as an icon.
    const opensThread = threadsOf(item).length > 0 && !action;
    const status = complete ? 'Complete' : shown.word;
    const running = activity.kind === 'working' ? buildActivity(item, unavailable) : null;
    const word = running?.running
        ? running.label
        : activity.kind === 'finished' && !RUNS.includes(item.status)
          ? null
          : ACTIVITY_WORD[activity.kind];
    const seen = word && activity.thread ? lastSeen(activity.thread) : '';
    // One waiting reason: a question, else what blocks it, else a blocked slice over a waiting child.
    const waits = !asks && open.length ? `Waiting on ${waitText(item, open)}` : null;
    const detail = partDetail(part, activity);
    const heldBySlice = activity.kind === 'child waiting' && item.slices.some((s) => s.progress === 'blocked');
    // One fact once: a run says In progress already, and an activity the status says, or that the wait replaces, is left out.
    const facts = waits
        ? [status, waits]
        : [
              ...(status === 'In progress' && activity.kind === 'working' ? [] : [status]),
              ...(word && word !== status && !heldBySlice ? [`${word}${seen}`] : []),
              ...detail,
          ];
    const state = facts.join(' · ');

    return (
        <div
            style={{ width, height: NODE_H }}
            data-map-part={item.id}
            className={`relative flex flex-col gap-1 overflow-hidden rounded-lg border bg-(--card) px-2.5 py-2 text-left shadow-xs ${tone} ${pickedRing(isPicked)}`}
        >
            <button
                type="button"
                aria-label={`Open ${ref(item)}`}
                title={`${itemName(item)} · ${state}`}
                onClick={() => useItemDialogStore.getState().open(item.id)}
                className="absolute inset-0 rounded-lg hover:bg-[color-mix(in_srgb,var(--accent)_60%,transparent)] focus-visible:outline-2 focus-visible:outline-(--primary)"
            />
            <SourceIcon item={item} corner className="pointer-events-none" />
            <span
                className="pointer-events-none relative flex min-h-6 min-w-0 items-center gap-1.5 pr-5 text-[11px] text-(--muted-foreground)"
                data-map-head
            >
                <PartKindLabel kind={part.kind} />
                {/* A build's lane already names its repository; the Decisions lane doesn't. */}
                {DECISION_KINDS.includes(part.kind) && repoKey(item) !== home && (
                    <RepoIdentity repo={repoKey(item)} data={data} />
                )}
                <AzureFields azure={item.azure} />
                {action && <span className="pointer-events-auto ml-auto shrink-0">{action}</span>}
                {opensThread && (
                    <span className="pointer-events-auto ml-auto shrink-0">
                        <OpenThread item={item} data={data} threadId={activity.thread?.id} iconOnly />
                    </span>
                )}
            </span>
            <span className="pointer-events-none relative line-clamp-2 text-[13px] leading-snug font-medium">
                <ItemTitle item={item} />
            </span>
            <span className="pointer-events-none relative mt-auto flex min-w-0 items-center gap-1.5 text-xs">
                <ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate" data-map-facts>
                    {state}
                </span>
            </span>
            {item.slices.length > 0 && (
                <span className="pointer-events-none absolute inset-x-2.5 bottom-0.5">
                    <SliceBar item={item} />
                </span>
            )}
        </div>
    );
}

/** A finished part as one row of the expanded history group: its kind, title, what it followed, PR and thread when it has them. */
function HistoryRow({ part, after, data, home }: { part: Part; after: Part[]; data: BoardData; home: string }) {
    const { item } = part;

    return (
        <li
            className="flex min-h-12 min-w-0 items-center gap-3 rounded-md px-3 text-[13px] hover:bg-(--soft)"
            data-history-part={item.id}
        >
            <StatusGlyph status="Done" className="size-3 shrink-0" />
            <span className="w-22 shrink-0">
                <PartKindLabel kind={part.kind} />
            </span>
            <button
                type="button"
                onClick={() => useItemDialogStore.getState().open(item.id)}
                title={itemName(item)}
                className="min-w-0 truncate rounded text-left hover:underline focus-visible:outline-2 focus-visible:outline-(--primary)"
            >
                <ItemTitle item={item} />
            </button>
            {after.length > 0 && (
                <span
                    className="min-w-0 shrink-[1000] truncate text-[11px] text-(--muted-foreground)"
                    title={`after ${after.map((u) => itemName(u.item)).join(', ')}`}
                >
                    after {after.map((u) => ref(u.item)).join(', ')}
                </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-(--muted-foreground)">
                {repoKey(item) !== home && <RepoIdentity repo={repoKey(item)} data={data} />}
                {item.linkedPrs.map((pr) => (
                    <span key={pr.number} className="inline-flex items-center gap-1">
                        <GitPullRequest className="size-3 text-(--st-done)" />
                        {prLabel(pr)}
                    </span>
                ))}
                {threadsOf(item).length > 0 && <OpenThread item={item} data={data} iconOnly />}
            </span>
        </li>
    );
}

/** How the group sums itself up: its settled decisions and finished builds, each left out at zero. */
const historyText = (parts: Part[]) => {
    const decisions = parts.filter((p) => DECISION_KINDS.includes(p.kind)).length;
    const builds = parts.length - decisions;

    return [decisions && plural(decisions, 'settled decision'), builds && plural(builds, 'finished build')]
        .filter(Boolean)
        .join(' · ');
};

function CheckNode({ check, width, after }: { check: EndToEndCheck; width: number; after: string }) {
    return (
        <div
            style={{ width, height: NODE_H }}
            data-map-check
            className="flex flex-col gap-1 rounded-lg border-2 border-dashed border-(--input) bg-(--card) px-2.5 py-2 shadow-xs"
        >
            <span className="flex items-center gap-1.5 text-[11px] text-(--muted-foreground)">
                <FlaskConical className="size-3.5" />
                end-to-end check
            </span>
            <span className="line-clamp-2 text-[13px] leading-snug font-medium">{check.title}</span>
            <span className="mt-auto flex min-w-0 items-center gap-1.5 text-xs">
                <StatusGlyph status="Queued" className="size-3 shrink-0" />
                <span className="min-w-0 truncate" title={after ? `After ${after}` : undefined}>
                    {plural(check.steps.length, 'step')}
                    {after && ` · after ${after}`}
                </span>
            </span>
        </div>
    );
}

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
    /** An arrow's line; the group's run in the gutter beside a column, so none passes behind a node. */
    const line = (from: Placed | undefined, to: Placed | undefined) => {
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
    };

    return (
        <div ref={box} className="overflow-x-auto rounded-lg border border-(--border) bg-(--background)" data-work-map>
            <div className="relative" style={{ width: m.width, height: m.height }} data-map-canvas>
                {m.bands.map((b, n) => (
                    <div
                        key={b.lane}
                        className={`absolute left-0 ${n ? 'border-t border-(--border)' : ''} ${n % 2 ? 'bg-[color-mix(in_srgb,var(--muted)_50%,transparent)]' : ''}`}
                        style={{ top: b.top, height: b.height, width: m.width }}
                    >
                        <div
                            className="sticky left-0 flex h-full flex-col justify-center gap-0.5 bg-[color-mix(in_srgb,var(--background)_85%,transparent)] px-3"
                            style={{ width: LABEL_W }}
                        >
                            <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                                {b.lane === DECISIONS ? (
                                    <>
                                        <Lightbulb className="size-3.5 text-(--muted-foreground)" />
                                        {DECISIONS}
                                    </>
                                ) : b.lane === home ? (
                                    <>
                                        <Hammer className="size-3.5 text-(--muted-foreground)" />
                                        Builds
                                    </>
                                ) : (
                                    <RepoIdentity repo={b.lane} data={data} />
                                )}
                            </span>
                        </div>
                    </div>
                ))}
                <svg
                    className="pointer-events-none absolute inset-0"
                    width={m.width}
                    height={m.height}
                    aria-hidden="true"
                >
                    <defs>
                        {['done', 'open'].map((k) => (
                            <marker
                                key={k}
                                id={`${marker}-${k}`}
                                viewBox="0 0 8 8"
                                refX="7"
                                refY="4"
                                markerWidth="7"
                                markerHeight="7"
                                orient="auto"
                            >
                                <path
                                    d="M0 0 8 4 0 8z"
                                    fill={k === 'done' ? 'var(--st-done)' : 'var(--muted-foreground)'}
                                />
                            </marker>
                        ))}
                    </defs>
                    {m.edges.map((e) => {
                        const a = at.get(e.from),
                            b = at.get(e.to);
                        const d = line(a, b);

                        if (!d) return null;

                        const done = e.from === HISTORY || (!!a?.part && isDone(a.part.item));
                        const lit = !!hover && (e.from === hover || e.to === hover);

                        return (
                            <path
                                key={`${e.from}-${e.to}`}
                                d={d}
                                fill="none"
                                data-edge={`${e.from} ${e.to}`}
                                stroke={done ? 'var(--st-done)' : 'var(--muted-foreground)'}
                                strokeWidth={lit ? 2.5 : 1.5}
                                strokeDasharray={done ? undefined : '5 4'}
                                opacity={hover && !lit ? 0.2 : done ? 0.7 : 0.9}
                                markerEnd={`url(#${marker}-${done ? 'done' : 'open'})`}
                            />
                        );
                    })}
                </svg>
                {m.edges.map((e) => {
                    if (!e.label) return null;

                    const to = at.get(e.to),
                        from = at.get(e.from);
                    const place = to
                        ? { left: to.x, top: to.y - 15, width: m.nodeW }
                        : from
                          ? { left: from.x + m.nodeW + 14, top: m.groupY - 15, width: m.colW - 20 }
                          : null;

                    return (
                        place && (
                            <Tooltip key={`${e.from}-${e.to}`}>
                                <TooltipTrigger asChild>
                                    <button
                                        type="button"
                                        aria-label={`${e.label}: ${e.names}`}
                                        onClick={() => setShowHistory(true)}
                                        data-edge-label={`${e.from} ${e.to}`}
                                        className="absolute truncate rounded text-left text-[11px] leading-3.5 text-(--muted-foreground) hover:text-(--foreground) hover:underline focus-visible:outline-2 focus-visible:outline-(--primary)"
                                        style={{ left: place.left, top: place.top, maxWidth: place.width }}
                                    >
                                        {e.label}
                                    </button>
                                </TooltipTrigger>
                                <TooltipPopup side="top">{e.names}</TooltipPopup>
                            </Tooltip>
                        )
                    );
                })}
                {m.placed.map((p) => (
                    <div
                        key={p.key}
                        className={`absolute transition-opacity ${near(p.key) ? '' : 'opacity-40'}`}
                        style={{ left: p.x, top: p.y }}
                        onMouseEnter={() => setHover(p.key)}
                        onMouseLeave={() => setHover(null)}
                    >
                        {p.part ? (
                            <PartNode part={p.part} data={data} width={m.nodeW} home={home} />
                        ) : (
                            check && <CheckNode check={check} width={m.nodeW} after={builds} />
                        )}
                    </div>
                ))}
                {history.length > 0 && (
                    <button
                        type="button"
                        aria-expanded={showHistory}
                        onClick={() => setShowHistory(!showHistory)}
                        data-map-history
                        onMouseEnter={() => setHover(HISTORY)}
                        onMouseLeave={() => setHover(null)}
                        className={`absolute flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-2.5 text-left text-xs shadow-xs transition-opacity hover:bg-(--accent) focus-visible:outline-2 focus-visible:outline-(--primary) ${near(HISTORY) ? '' : 'opacity-40'}`}
                        style={{ left: 12, right: 12, top: m.groupY, height: GROUP_H }}
                    >
                        <StatusGlyph status="Done" className="size-3.5 shrink-0" />
                        <span className="min-w-0 truncate font-medium">{historyText(history)}</span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-(--muted-foreground)">
                            {showHistory ? (
                                <>
                                    Hide
                                    <ChevronDown className="size-3.5" />
                                </>
                            ) : (
                                <>
                                    Show
                                    <ChevronRight className="size-3.5" />
                                </>
                            )}
                        </span>
                    </button>
                )}
            </div>
            {showHistory && (
                <ol
                    className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,28rem),1fr))] gap-x-4 gap-y-1 px-3 pb-3"
                    style={{ width: m.width }}
                    data-map-history-parts
                >
                    {history.map((p) => (
                        <HistoryRow key={keyOf(p)} part={p} after={ups(p).filter(isHistory)} data={data} home={home} />
                    ))}
                </ol>
            )}
        </div>
    );
}
