// The work map's nodes: a part, the end-to-end check, and a finished part's row in the expanded history group, with
// the kind label and repository identity every map surface shows.

import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import {
    buildActivity,
    itemName,
    humanWait,
    plural,
    prLabel,
    projectWorkMap,
    ref,
    repoKey,
    repoName,
    retiredPartLabel,
} from '@lar-factory/shared';
import { statusStateColors } from '@lar-works/design-system';

import { ActivityLine } from './ActivityLine';
import type { Part } from './DossierParts';
import { DECISION_KINDS, isDone, openWaits, partActivity, threadsOf } from './DossierParts';
import { ACTIVITY_WORD, GATE_WORDS, partDetail, RUNS } from './MapCardFacts';
import { PartAction } from './PartAction';
import { partState } from './PartState';
import { PartTitle } from './PartTitle';
import { RowKindMark } from './RowIdentity';
import { lastSeen } from './StageStatus';
import { useActivityState } from './useActivityState';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    CardActions,
    AzureFields,
    ItemStatusGlyph,
    OpenThread,
    SliceBar,
    StatusGlyph,
    useActivityUnavailable,
    useShownStatus,
    STATUS_COLOR,
    workflowSteps,
    stepName,
    SourceIcon,
    checksWord,
    prChecks,
} from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import {
    HistoryRow as DesignHistoryRow,
    MapCheckNode,
    MapPartNode,
    PullRequestRef,
    StageTrack,
    CardChecks,
    RepoIdentity as DesignRepoIdentity,
} from '@/ui/board';

/** A repository's identity on the map, its project icon and name together, as a lane's label and a history row name it;
 *  its tooltip names the repository in full. */
export function MapRepo({ repo, data }: { repo: string; data: BoardData }) {
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

export function PartNode({
    part,
    data,
    width,
    height,
    home,
    history,
}: {
    part: Part;
    data: BoardData;
    width: number;
    /** The map's card height, which its tallest card needs. */
    height: number;
    home: string;
    /** The finished parts it followed, counted and named, for its tooltip rather than a label over every column. */
    history?: string | undefined;
}) {
    const { item } = part;
    const record = projectWorkMap([item]).nodes[0]!;
    const isPicked = useItemDialogStore((state) => state.itemId === item.id);
    const open = openWaits(part);
    const complete = isDone(item);
    const shown = useShownStatus(item);
    const steps = workflowSteps(item);
    const at = steps.findIndex((step) => step === shown.progressStage);
    const checks = prChecks(item);
    const unavailable = useActivityUnavailable();
    const activity = partActivity(part, shown.working, unavailable);
    const wait = humanWait(item, unavailable, data.items);
    const asks = !!wait;
    const attention = asks ? 'asks' : open.length ? 'waits' : 'default';
    // Its one state, in the words its parts list row says: a question, else what holds it ("Blocked by Part 15"), else
    // the presenter's stage word. The head shows no stage word of its own, so the card never says two things.
    const status = wait && !complete ? wait.label : partState(item, data, shown.stageWord);
    const held = /^(Blocked|Waits on|Waiting)/.test(status);
    // Its lane names its project; a decision made in another project names that one under its title, beside the queue
    // and gate facts its work record holds.
    const otherProject = DECISION_KINDS.includes(part.kind) && repoKey(item) !== home;
    const recordState = [
        record.queued ? null : 'Not queued',
        record.gate === 'not applicable' ? null : GATE_WORDS[record.gate],
    ]
        .filter(Boolean)
        .join(' · ');
    // While its thread is at work, what it does now takes a line of its own, as its parts-list row shows it.
    const activityState = useActivityState(item);
    // Blocked or waiting on other work, its step and track go quiet so the foot's "Blocked by #139" is its state.
    const quiet = !complete && !asks && (held || attention === 'waits');
    const running = activity.kind === 'working' ? buildActivity(item, unavailable) : null;
    // A thread at work says the presenter's word (Working, Quiet or its phase), as its row and dialog do.
    const word =
        activity.kind === 'needs you'
            ? (wait?.label ?? shown.word)
            : activity.kind === 'working' && (shown.execution === 'working' || shown.execution === 'quiet')
              ? shown.word
              : running?.running
                ? running.label
                : activity.kind === 'finished' && !RUNS.includes(item.status)
                  ? null
                  : ACTIVITY_WORD[activity.kind];
    const seen = word && activity.thread ? lastSeen(activity.thread) : '';
    const detail = partDetail(part, activity);
    const heldBySlice = activity.kind === 'child waiting' && item.slices.some((s) => s.progress === 'blocked');
    // One fact once: a run says In progress already, and an activity the status already says is left out; what its
    // thread does always shows, held or not.
    const facts = [
        ...(status === 'In progress' && activity.kind === 'working' ? [] : [status]),
        ...(word && word !== status && !heldBySlice ? [`${word}${seen}`] : []),
        ...detail,
    ];
    // The head's checks already say how the pipeline stands, so a fact about the checks would say it twice.
    const state = facts.filter((fact) => !(checks && fact.startsWith('Checks '))).join(' · ');

    return (
        <MapPartNode
            id={item.id}
            width={width}
            height={height}
            attention={attention}
            held={quiet}
            track={
                checks ? (
                    // In review the PR's checks are what move, as on a desk card: its step, the PR's mark and its checks.
                    <CardChecks checks={checks} step={at >= 0 ? stepName(steps[at]!) : ''} word={checksWord(checks)} />
                ) : (
                    at >= 0 && (
                        <StageTrack
                            steps={steps.length}
                            at={at}
                            color={
                                quiet
                                    ? statusStateColors.off
                                    : shown.progressState
                                      ? statusStateColors[shown.progressState]
                                      : STATUS_COLOR[item.status]
                            }
                            label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}
                            step={stepName(steps[at]!)}
                        />
                    )
                )
            }
            // Its leading bar: green once done, the accent while its thread works; what it needs takes precedence.
            tone={
                complete
                    ? 'done'
                    : shown.running || activity.kind === 'working' || status === 'Working'
                      ? 'active'
                      : undefined
            }
            picked={isPicked}
            openLabel={`Open ${ref(item)}`}
            title={[itemName(item), ...facts, history].filter(Boolean).join(' · ')}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            source={<SourceIcon item={item} corner />}
            head={
                <>
                    {/* Its kind in words, by the mark its parts-list row shows. */}
                    <RowKindMark item={item} labelled />
                    <AzureFields azure={item.azure} />
                </>
            }
            // A card's action is named, never the rows' icon-only form, and tinted like every row action (CardActions).
            action={
                <CardActions>
                    <PartAction part={part} data={data} />
                </CardActions>
            }
            // Its number leads its title, "#139" or "Part 15", as its parts-list row and every blocker name it.
            name={<PartTitle item={item} />}
            glyph={<ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} size="sm" />}
            facts={state}
            repository={otherProject && <MapRepo repo={repoKey(item)} data={data} />}
            recordState={recordState}
            activity={!complete && activityState && <ActivityLine item={item} />}
            waitReason={record.waits.join(' · ')}
            slices={!checks && item.slices.length > 0 && <SliceBar item={item} />}
        />
    );
}

/** A finished part as one row of the expanded history group: its kind, title, what it followed, PR and thread when it has them. */
export function HistoryRow({ part, after, data, home }: { part: Part; after: Part[]; data: BoardData; home: string }) {
    const { item } = part;
    const picked = useItemDialogStore((state) => state.itemId === item.id);

    return (
        <DesignHistoryRow
            id={item.id}
            picked={picked}
            glyph={<StatusGlyph status="Done" size="sm" />}
            kind={<RowKindMark item={item} labelled />}
            name={itemName(item)}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            title={<PartTitle item={item} />}
            after={after.length > 0 ? `after ${after.map((u) => ref(u.item)).join(', ')}` : undefined}
            afterTitle={`after ${after.map((u) => itemName(u.item)).join(', ')}`}
            side={
                <>
                    {retiredPartLabel(item)}
                    {repoKey(item) !== home && <MapRepo repo={repoKey(item)} data={data} />}
                    {item.linkedPrs.map((pr) => (
                        <PullRequestRef key={pr.number} label={prLabel(pr)} />
                    ))}
                    {threadsOf(item).length > 0 && <OpenThread item={item} data={data} iconOnly />}
                </>
            }
        />
    );
}

export function CheckNode({
    check,
    width,
    height,
    after,
}: {
    check: EndToEndCheck;
    width: number;
    height: number;
    after: string;
}) {
    return (
        <MapCheckNode
            width={width}
            height={height}
            label="Outcome check"
            title={check.title}
            glyph={<StatusGlyph status="Queued" size="sm" />}
            steps={`${plural(check.steps.length, 'step')}${after ? ` · after ${after}` : ''}`}
            stepsTitle={after ? `After ${after}` : undefined}
        />
    );
}
