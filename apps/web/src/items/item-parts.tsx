// The bits every view draws for an item: its numbered title, title link, kind badge, label chips and
// slice bar, and the item dialog's repository tag, slices, pull requests, checks, and agent work. The tag is the design system's Badge, with
// the repository's project icon.

import {
    UNREADABLE,
    activityLost,
    activityUnavailable,
    buildActivity,
    clock,
    day,
    decisionMethodName,
    itemActivityLine,
    itemActivityThread,
    startProgressOf,
    workingAgain,
    checkState,
    duration,
    formatTokens,
    formatUsd,
    itemName,
    itemRepoNames,
    prLabel,
    ref,
    labelsOnRow,
    repoKey,
    repoName,
    shortAgo,
} from '@lar-factory/shared';
import type {
    AzureWorkItem,
    BoardData,
    Checks,
    Item,
    ItemStats,
    Kind,
    RepoConfig,
    SliceProgress,
    Status,
} from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import {
    ArrowLeftRight,
    Bug,
    Check,
    GitPullRequest,
    Lightbulb,
    Sparkles,
    TrendingUp,
    type LucideIcon,
} from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { useBoardStore } from '../board/board-store.ts';
import { useClock } from '../board/second-clock.ts';
import { isDone } from '../line/dossier-parts.ts';
import { ambientMotion } from '../motion/ambient-motion.ts';
import { ProjectIcon } from '../repositories/project-icon.tsx';
import { tint } from './label-tint.ts';
import { PrReadiness } from './pr-readiness.tsx';
import { SourceIcon } from './source-icon.tsx';
import { PURPOSE, useStart } from './start-store.ts';

/** The control room's repository badge, with a medium label. */
export function RepoTag({ repo, repos }: { repo: string; repos: readonly RepoConfig[] }) {
    return (
        <Badge className="gap-1.5">
            <ProjectIcon repo={repo} size="small" />
            {repoName(repo, repos)}
        </Badge>
    );
}

/** A row's repository: its project icon and name. Where the ticket is saved is SourceIcon's to say, beside it. */
export function RepoCell({ item }: { item: Item }) {
    const repos = useBoardStore((state) => state.data.repos);
    return (
        <span data-repo-cell className="flex min-w-0 items-center gap-1">
            <ProjectIcon repo={repoKey(item)} size="small" />
            <span className="truncate">{itemRepoNames(item, repos)}</span>
        </span>
    );
}

export function TitleLink({ item, className = 'title' }: { item: Item; className?: string }) {
    const text = (
        <>
            {item.number ? (
                <>
                    <span className="ref">{ref(item)}</span>{' '}
                </>
            ) : null}
            {item.title}
        </>
    );
    return item.url ? (
        <a className={className} href={item.url} target="_blank" rel="noopener">
            {text}
        </a>
    ) : (
        <span className={className}>{text}</span>
    );
}

/** An item's title with its ticket's number before it, muted, the way the board lists every item; captured work has no number. */
export function ItemTitle({ item }: { item: Item }) {
    return (
        <>
            {item.number ? (
                <>
                    <span className="font-normal text-(--muted-foreground) tabular-nums">{ref(item)}</span>{' '}
                </>
            ) : null}
            {item.title}
        </>
    );
}

/** Azure's type, state and assignee as one compact line beside factory status. */
export function AzureFields({ azure }: { azure: AzureWorkItem | undefined }) {
    if (!azure) return null;
    const text = [azure.type, azure.state, azure.assignee].filter(Boolean).join(' · ');
    return (
        <span data-azure title={text} className="block min-w-0 truncate text-xs text-(--muted-foreground)">
            {text}
        </span>
    );
}

const SLICE_COLOR: Record<SliceProgress, string> = {
    done: 'var(--st-done)',
    active: 'var(--st-now)',
    blocked: 'var(--st-review)',
    unknown: 'var(--muted-foreground)',
    waiting: 'var(--input)',
};

/** A 6px segment for each recorded slice; waiting segments are faint. `still` stops an active one pulsing. */
export function SliceBar({ item, still = false }: { item: Item; thick?: boolean; still?: boolean }) {
    if (!item.slices.length) return null;
    return (
        <ol className="m-0 flex list-none gap-[2px] p-0">
            {item.slices.map((s, i) => (
                <li
                    key={i}
                    ref={s.progress === 'active' && !still ? ambientMotion : undefined}
                    title={itemName(s)}
                    className={`h-1.5 flex-1 rounded-full ${s.progress === 'active' && !still ? 'status-pulse' : ''}`}
                    style={{ background: s.progress === 'waiting' ? 'var(--soft)' : SLICE_COLOR[s.progress] }}
                />
            ))}
        </ol>
    );
}

/** A slice's state as a ring: ticked when done, a pulsing dot while active. */
export function SliceMark({ progress, still = false }: { progress: SliceProgress; still?: boolean }) {
    return (
        <span
            className="grid size-4 shrink-0 place-items-center rounded-full border-[1.5px]"
            style={{
                borderColor: SLICE_COLOR[progress],
                background: progress === 'done' ? 'var(--st-done)' : 'transparent',
            }}
        >
            {progress === 'unknown' && <span className="text-[9px] leading-none">?</span>}
            {progress === 'done' && <Check className="size-2.5 text-white" strokeWidth={3} />}
            {progress === 'active' && (
                <span
                    ref={still ? undefined : ambientMotion}
                    className={`${still ? '' : 'status-pulse '}size-1.5 rounded-full bg-(--st-now)`}
                />
            )}
        </span>
    );
}

export function SliceList({ item, still = false }: { item: Item; still?: boolean }) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0">
            {item.slices.map((s, i) => (
                <li key={i} className="flex items-start gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-(--soft)">
                    <SourceIcon item={s} />
                    <span className="mt-0.5">
                        <SliceMark progress={s.progress} still={still} />
                    </span>
                    {s.number > 0 && (
                        <span className="shrink-0 text-(--muted-foreground) tabular-nums">#{s.number}</span>
                    )}
                    <span
                        className={`min-w-0 flex-1 wrap-anywhere ${s.progress === 'done' ? 'text-(--muted-foreground) line-through' : s.progress === 'active' ? 'font-medium' : ''}`}
                    >
                        {s.title}
                    </span>
                    <span className="mt-px shrink-0 text-[11px] text-(--muted-foreground)">{s.progress}</span>
                </li>
            ))}
        </ul>
    );
}

const CHECKS_COLOR = { failed: 'var(--error)', running: 'var(--warning)', passed: 'var(--st-done)' } as const;

/** A pull request's checks as a coloured dot and their state, with the passed count when `counts`; nothing when it has none. */
function ChecksBadge({ checks, counts }: { checks: Checks | null; counts?: boolean }) {
    const state = checkState(checks);
    if (!checks || !state) return null;
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-(--muted-foreground)">
            <span className="size-2 rounded-full" style={{ background: CHECKS_COLOR[state] }} />
            checks {state}
            {counts && (
                <span className="tabular-nums">
                    · {checks.passed}/{checks.total} passed
                </span>
            )}
        </span>
    );
}

export function PrList({ item }: { item: Item }) {
    return (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] gap-1 p-0">
            {item.linkedPrs.map((pr) => (
                <li
                    key={pr.number}
                    className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-(--border) bg-(--card) px-3 py-2"
                >
                    <GitPullRequest className="size-4 shrink-0 text-(--st-done)" />
                    <a
                        href={pr.url}
                        target="_blank"
                        rel="noopener"
                        className="min-w-0 flex-1 basis-24 font-medium wrap-anywhere hover:underline"
                    >
                        {prLabel(pr)}
                    </a>
                    <ChecksBadge checks={pr.checks} />
                    <PrReadiness item={item} pr={pr} />
                </li>
            ))}
        </ul>
    );
}

/**
 * While usage can't be read for this item, or for any, the sentence that says shown figures are the ones last seen; otherwise
 * null. The whole board's last read says when only while it fails, as a read that works says nothing of a failing family.
 */
export function useLastKnown(item: Item): string | null {
    const read = useBoardStore((state) => state.data.usageRead);
    const unreadable = read?.readable === false;
    if (!unreadable && item.usageState !== 'failed') return null;
    const at =
        unreadable && read.readAt ? ` from ${day(read.readAt, undefined)}, ${clock(read.readAt, undefined)}` : '';
    return `Last known figures${at}: T3 Code's usage can't be read now.`;
}

/** Why a total isn't the whole sum. */
export const INCOMPLETE_TOTAL = "This total is incomplete: usage for part of it is still loading or can't be read.";

/** Whether figures say anything: all-zero ones say no more than having none. */
export const hasFigures = (s: ItemStats) => Boolean(s.agentMs || s.wallMs || s.tokens || s.costUsd);

/**
 * Cost, agent time, tokens and wall time as one small muted line after any `label`, each named in the tooltip; nothing
 * when no thread worked on the item or T3's database can't be read. While T3 can't be read, the board keeps the figures
 * it last saw, and the line says so. `stats` shows other figures than the item's own.
 */
export function AgentWork({
    item,
    stats: s = item.stats,
    label,
    className = '',
}: {
    item: Item;
    stats?: ItemStats | 'unavailable';
    label?: string;
    className?: string;
}) {
    const lastKnown = useLastKnown(item);
    if (!s || s === 'unavailable' || !hasFigures(s)) return null;
    const old = !s.frozen ? lastKnown : null;
    const figures: [label: string, value: string, unit: string][] = [];
    if (s.costUsd !== undefined) figures.push(['Cost', formatUsd(s.costUsd), '']);
    figures.push(['Agent time', duration(s.agentMs), ''], ['Tokens', formatTokens(s.tokens), ' tokens']);
    if (s.wallMs) figures.push(['Wall time', duration(s.wallMs), ' wall']);
    return (
        <p
            data-agent-work
            data-last-known={old ? '' : undefined}
            title={[figures.map(([k, v]) => `${k} ${v}`).join(' · '), old, s.incomplete && INCOMPLETE_TOTAL]
                .filter(Boolean)
                .join('. ')}
            className={`m-0 text-xs text-(--muted-foreground) tabular-nums ${className}`}
        >
            {label && `${label}: `}
            {figures.map(([, v, unit]) => v + unit).join(' · ')}
            {old && ' · last known'}
            {s.incomplete && ' · incomplete'}
        </p>
    );
}

/**
 * Whether the item's figures are still to come: its usage is loading, a read can still replace its provisional figures, or
 * no stats read has reached its threads yet. Figures frozen at merge are final, and a settled read with nothing, or no thread,
 * is known empty. Figures stay provisional while a never-observed thread keeps failing, which no coming read answers.
 */
export const usageLoading = (
    { stats, usageState, threads }: Item,
    { firstRead, items }: Pick<BoardData, 'firstRead' | 'items'>,
): boolean => {
    if (typeof stats === 'object' && stats.frozen) return false;
    if (usageState === 'loading') return true;
    if (typeof stats === 'object' && stats.provisional)
        return !firstRead.settled || items.some((other) => other.usageState === 'loading');
    return !usageState && stats === undefined && Array.isArray(threads) && threads.length > 0;
};

/** Whether T3's usage can't be read for this item: an item known to have no thread has none to lose. */
export const usageUnreadable = (item: Item): boolean =>
    (item.stats === 'unavailable' || (item.usageState === 'failed' && !(item.stats && hasFigures(item.stats)))) &&
    !(Array.isArray(item.threads) && !item.threads.length);

/** The line that says why there are no agent work figures: no T3 thread worked on the item, or T3's database can't be read. */
export function AgentWorkNote({ item }: { item: Item }) {
    // Usage loads only for recorded threads, which T3 may not have answered for yet.
    const hasThread = item.usageState === 'loading' || (Array.isArray(item.threads) && item.threads.length > 0);
    const s = usageUnreadable(item) ? 'unavailable' : hasThread ? item.stats : undefined;
    // Known figures answer for an item still loading; none, or all zeros, say no more than having none.
    if (s && s !== 'unavailable' && (item.usageState !== 'loading' || hasFigures(s))) return null;
    // A settled decision may have no thread of its own, which is nothing to wait for.
    if (!s && !hasThread && item.kind === 'decision' && isDone(item)) return null;
    const none = item.kind === 'concept' ? 'No T3 thread of its own.' : 'No T3 thread has worked on this yet.';
    return (
        <p className="m-0 text-xs text-(--muted-foreground)">
            {s === 'unavailable' ? UNREADABLE : hasThread ? 'Usage totals are still loading.' : none}
        </p>
    );
}

export const KIND_BADGES: Partial<Record<Kind, { name: string; icon: LucideIcon; hue: number }>> = {
    bug: { name: 'Bug', icon: Bug, hue: 25 },
    feature: { name: 'Feature', icon: Sparkles, hue: 150 },
    improvement: { name: 'Improvement', icon: TrendingUp, hue: 245 },
    concept: { name: 'Concept', icon: Lightbulb, hue: 300 },
};

/** A kind in its colour with its icon, then `children`; builds, decisions and tickets with no recognised kind have none. */
export function KindBadge({ kind, children }: { kind: Kind; children?: ReactNode }) {
    const badge = KIND_BADGES[kind];
    if (!badge) return null;
    const { name, icon: Icon, hue } = badge;
    return (
        <Badge data-kind-badge hue={hue}>
            <Icon aria-hidden="true" />
            {name}
            {children}
        </Badge>
    );
}

/** Beside a row's kind badge, in the row's muted text: what the ticket says instead, until someone answers. */
export function KindMarker({ item }: { item: Pick<Item, 'kindDisagreement'> }) {
    const { kindDisagreement: disagreement } = item;
    if (!disagreement || disagreement.kept) return null;
    const said = disagreement.ticketKind ? KIND_BADGES[disagreement.ticketKind]!.name : 'No kind';
    const sentence = disagreement.ticketKind ? `The ticket says ${said}.` : 'The ticket has no kind.';
    return (
        <span
            data-kind-marker
            title={`${sentence} Open to choose.`}
            aria-label={sentence}
            className="inline-flex items-center gap-0.5 text-[11px] text-(--muted-foreground)"
        >
            <ArrowLeftRight className="size-2.5" aria-hidden="true" />
            {said}
        </span>
    );
}

type LabelledItem = Pick<Item, 'kind' | 'labels' | 'labelColors' | 'repo'>;

/** The labels of `item` that its row shows, under its repository's mappings. */
export function useShownLabels(item: LabelledItem): string[] {
    return labelsOnRow(
        item,
        useBoardStore((state) => state.data.repos),
    );
}

/** The item's shown labels as chips, in the tracker's colours. */
export function LabelChips({ item }: { item: LabelledItem }) {
    return (
        <>
            {useShownLabels(item).map((label) => (
                <Badge key={label} data-label-chip className="max-w-full" style={tint(item.labelColors?.[label])}>
                    <span className="max-w-52 truncate" title={label}>
                        {label}
                    </span>
                </Badge>
            ))}
        </>
    );
}

/** Kind and relationships remain visible before an issue is queued. `onRow` leaves out the word for work with no kind badge. */
export function ItemKind({ item, onRow = false }: { item: Item; onRow?: boolean }) {
    const words: string[] = [];
    const method = decisionMethodName(item);
    if (method) words.push(method);
    else if (!onRow && !KIND_BADGES[item.kind]) words.push('Work');
    const parentKind = useBoardStore(
        (state) =>
            state.data.items.find((parent) =>
                Boolean(
                    (item.parentId && parent.id === item.parentId) ||
                    (item.parent?.url && parent.url === item.parent.url),
                ),
            )?.kind,
    );
    const parentIsConcept = item.tracker?.parent?.kind === 'concept' || parentKind === 'concept';
    if (parentIsConcept) words.push('Part of a concept');
    else if (item.parent) words.push('Part of another issue');
    if (item.tracker?.connections?.length || item.tracker?.dependencies?.length) words.push('Across Projects');
    const badge = KIND_BADGES[item.kind];
    return badge || words.length ? (
        <span data-item-kind className="inline-flex flex-wrap gap-1">
            <KindBadge kind={item.kind} />
            {onRow && <KindMarker item={item} />}
            {words.map((word) => (
                <Badge key={word}>{word}</Badge>
            ))}
        </span>
    ) : null;
}

export function StructureSync({ item }: { item: Item }) {
    return (
        <>
            {item.specSync && (
                <span data-spec-sync role="status" className="text-base-700 text-xs">
                    {item.specSync.warning ?? item.specSync.error ?? 'Spec waiting to save to tracker'}
                </span>
            )}
            {item.sync && item.sync.state !== 'saved' && (
                <span
                    data-structure-sync
                    title={item.sync.message}
                    role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : undefined}
                    className="text-base-700 text-xs"
                >
                    Planning is saved on this Mac.
                </span>
            )}
        </>
    );
}

/** How long ago `at` was. It alone follows the clock, so a tick renders nothing around it. */
export const Age = ({ at }: { at: string }) => <>{useBoardStore((state) => shortAgo(at, state.now))}</>;

export const useActivityUnavailable = () =>
    useBoardStore(({ data, now, clientError }) => activityUnavailable(data, now, clientError));

/** Whether T3's answer for `item`'s thread is lost, which a read going old changes with no new data. */
const useActivityLost = (item: Item) => useClock((now) => activityLost(itemActivityThread(item)?.activity, now));

export function useActivityFeedback(item: Item) {
    const data = useBoardStore((state) => state.data);
    // Shaping work has an activity only while a start runs; Start build's holds every other status.
    const kind = item.status === 'Shaping' || item.status === 'Queued' ? 'refine' : 'build';
    const pressed = useStart(item.id, kind)?.phase === 'pending';
    const unavailable = useActivityUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);
    const lineState = useClock((now) => itemActivityLine(item, now, disconnected)?.state);
    // An error from another read, such as GitHub's, leaves T3's activity readable, and the row's phase with it.
    const readable = !!lineState && lineState !== 'unavailable';
    const lost = useActivityLost(item);
    return buildActivity(
        item,
        (unavailable && !readable) || lost,
        pressed ? { phase: 'starting' } : startProgressOf(data, item.id, PURPOSE[kind]),
    );
}

/** How the board names an item now: its recorded Status, or Working while it is at work again. */
export function shownStatus(item: Item, unavailable: boolean): { working: boolean; word: string; glyph: Status } {
    return workingAgain(item, unavailable)
        ? { working: true, word: 'Working', glyph: 'In progress' }
        : { working: false, word: item.status, glyph: item.status };
}

export const useShownStatus = (item: Item) => {
    const unavailable = useActivityUnavailable();
    const lost = useActivityLost(item);
    return shownStatus(item, unavailable || lost);
};

export function ActivityFeedback({
    feedback,
    labelOnly = false,
}: {
    feedback: ReturnType<typeof buildActivity>;
    labelOnly?: boolean;
}) {
    if (labelOnly)
        return (
            <span className="block h-4 text-[11px] leading-4 whitespace-nowrap text-(--muted-foreground)">
                {feedback.label}
            </span>
        );
    return (
        <div
            role="img"
            aria-label={feedback.label}
            className="activity-track h-1.5 overflow-hidden rounded-full bg-(--soft)"
        >
            {feedback.running && (
                <span ref={ambientMotion} className="activity-sweep block h-1.5 w-1/3 rounded-full bg-(--st-now)" />
            )}
        </div>
    );
}
