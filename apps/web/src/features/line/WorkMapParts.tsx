// The work map's nodes: a part, the end-to-end check, and a finished part's row in the expanded history group, with
// the kind label and repository identity every map surface shows.

import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
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
import type { ReactNode } from 'react';

import type { Part, PartActivity, PartKind } from './DossierParts';
import { DECISION_KINDS, isDone, openWaits, partActivity, partLabel, threadsOf, waitText } from './DossierParts';
import { PartStart } from './PartStart';
import { lastSeen } from './StageStatus';
import { NODE_H } from './WorkMapLayout';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    AzureFields,
    ItemStatusGlyph,
    ItemTitle,
    OpenThread,
    SliceBar,
    SourceIcon,
    StatusGlyph,
    useActivityUnavailable,
    useShownStatus,
} from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import {
    HistoryRow as DesignHistoryRow,
    MapCheckNode,
    MapPartNode,
    PartKindLabel as DesignPartKindLabel,
    PullRequestRef,
    RepoIdentity as DesignRepoIdentity,
} from '@/ui/board';

/** A part's method or kind, in the one place and style every map surface shows it. */
export function PartKindLabel({ kind }: { kind: PartKind }) {
    return <DesignPartKindLabel kind={kind}>{partLabel(kind)}</DesignPartKindLabel>;
}

/** Another repository's identity, its project icon and name together; the corner's source icon says where the ticket lives instead. */
export function RepoIdentity({ repo, data }: { repo: string; data: BoardData }) {
    return (
        <DesignRepoIdentity
            data-part-repo
            presentation="map"
            title={repo}
            icon={<ProjectIcon repo={repo} size="sm" />}
            name={repoName(repo, data.repos)}
        />
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
    const attention = asks ? 'asks' : open.length ? 'waits' : 'default';
    let action: ReactNode = null;

    if (complete) action = null;
    else if (asks)
        action = <OpenThread item={item} data={data} threadId={openQuestionThread(item)?.id} label="Answer in T3" />;
    else if (item.status === 'Ready' || item.status === 'Queued')
        action = <PartStart part={part} data={data} label="Start" namesBlocker={false} />;

    // Each card has one labelled thread action. Decision threads are where their answers are given.
    const opensThread = threadsOf(item).length > 0 && !action;
    // The node says what its thread does beside its status, so the status leaves that out.
    const status = complete ? 'Complete' : shown.stageWord;
    const running = activity.kind === 'working' ? buildActivity(item, unavailable) : null;
    // A thread at work says the presenter's word (Working, Quiet or its phase), as its row and dialog do.
    const word =
        activity.kind === 'working' && (shown.execution === 'working' || shown.execution === 'quiet')
            ? shown.word
            : running?.running
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
        ? status.startsWith('Blocked')
            ? [status]
            : [status, waits]
        : [
              ...(status === 'In progress' && activity.kind === 'working' ? [] : [status]),
              ...(word && word !== status && !heldBySlice ? [`${word}${seen}`] : []),
              ...detail,
          ];
    const state = facts.join(' · ');

    return (
        <MapPartNode
            id={item.id}
            width={width}
            height={NODE_H}
            attention={attention}
            picked={isPicked}
            openLabel={`Open ${ref(item)}`}
            title={`${itemName(item)} · ${state}`}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            source={<SourceIcon item={item} corner />}
            head={
                <>
                    <PartKindLabel kind={part.kind} />
                    {/* A build's lane already names its repository; the Decisions lane doesn't. */}
                    {DECISION_KINDS.includes(part.kind) && repoKey(item) !== home && (
                        <RepoIdentity repo={repoKey(item)} data={data} />
                    )}
                    <AzureFields azure={item.azure} />
                </>
            }
            action={
                action ??
                (opensThread && (
                    <OpenThread
                        item={item}
                        data={data}
                        threadId={activity.thread?.id}
                        label={
                            !complete && !open.length && DECISION_KINDS.includes(part.kind)
                                ? 'Answer in T3'
                                : 'Open thread'
                        }
                    />
                ))
            }
            name={<ItemTitle item={item} />}
            glyph={<ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} size="sm" />}
            facts={state}
            slices={item.slices.length > 0 && <SliceBar item={item} />}
        />
    );
}

/** A finished part as one row of the expanded history group: its kind, title, what it followed, PR and thread when it has them. */
export function HistoryRow({ part, after, data, home }: { part: Part; after: Part[]; data: BoardData; home: string }) {
    const { item } = part;

    return (
        <DesignHistoryRow
            id={item.id}
            glyph={<StatusGlyph status="Done" size="sm" />}
            kind={<PartKindLabel kind={part.kind} />}
            name={itemName(item)}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            title={<ItemTitle item={item} />}
            after={after.length > 0 ? `after ${after.map((u) => ref(u.item)).join(', ')}` : undefined}
            afterTitle={`after ${after.map((u) => itemName(u.item)).join(', ')}`}
            side={
                <>
                    {repoKey(item) !== home && <RepoIdentity repo={repoKey(item)} data={data} />}
                    {item.linkedPrs.map((pr) => (
                        <PullRequestRef key={pr.number} label={prLabel(pr)} />
                    ))}
                    {threadsOf(item).length > 0 && <OpenThread item={item} data={data} iconOnly />}
                </>
            }
        />
    );
}

export function CheckNode({ check, width, after }: { check: EndToEndCheck; width: number; after: string }) {
    return (
        <MapCheckNode
            width={width}
            height={NODE_H}
            label="Outcome check"
            title={check.title}
            glyph={<StatusGlyph status="Queued" size="sm" />}
            steps={`${plural(check.steps.length, 'step')}${after ? ` · after ${after}` : ''}`}
            stepsTitle={after ? `After ${after}` : undefined}
        />
    );
}
