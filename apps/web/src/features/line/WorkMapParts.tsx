// The work map's nodes: a part, the end-to-end check, and a finished part's row in the expanded history group, with
// the kind label and repository identity every map surface shows.

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
import {
    BookOpen,
    FlaskConical,
    GitPullRequest,
    Hammer,
    ListChecks,
    MessagesSquare,
    Shapes,
} from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { DECISION_KINDS, isDone, openWaits, partActivity, partLabel, threadsOf, waitText } from './DossierParts';
import type { Part, PartActivity, PartKind } from './DossierParts';
import { PartStart } from './PartStart';
import { lastSeen } from './StageTrack';
import { NODE_H } from './WorkMapLayout';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    AzureFields,
    ItemTitle,
    SliceBar,
    useActivityUnavailable,
    useShownStatus,
    OpenThread,
    SourceIcon,
    ItemStatusGlyph,
    StatusGlyph,
} from '@/features/items';
import { ProjectIcon } from '@/features/repositories';

const KIND_ICON: Record<PartKind, typeof Hammer> = {
    grill: MessagesSquare,
    prototype: Shapes,
    research: BookOpen,
    task: ListChecks,
    decision: MessagesSquare,
    build: Hammer,
};
const pickedRing = (on: boolean) => (on ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-(--card)' : '');

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
export function RepoIdentity({ repo, data }: { repo: string; data: BoardData }) {
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

export function PartNode({ part, data, width, home }: { part: Part; data: BoardData; width: number; home: string }) {
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
export function HistoryRow({ part, after, data, home }: { part: Part; after: Part[]; data: BoardData; home: string }) {
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

export function CheckNode({ check, width, after }: { check: EndToEndCheck; width: number; after: string }) {
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
