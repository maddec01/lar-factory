// User-facing words derived from the shared domain.

import {
    type DependencyObservationKind,
    type Item,
    type Blocker,
    openBlockers,
    type DependencyHold,
    type ModelGroup,
    type ModelSelection,
    type BoardData,
    isOnboarding,
    repositoryProjectHint,
    decisionType,
    type Checks,
    type RepoConfig,
    repoKey,
    decodePart,
    sameRepo,
    type StartProgress,
    workingAgain,
    currentBuildThread,
    delegatedWorkRunning,
} from './domain.ts';
import { type OperationAccess } from './model-settings.ts';

/** Each kind of read as the board says it. */
export const DEPENDENCY_OBSERVATION_WORDS: Record<DependencyObservationKind, string> = {
    open: 'open',
    closed: 'closed',
    merged: 'merged',
    reopened: 'reopened',
    deleted: 'deleted',
    'access-lost': 'access lost',
    'read-failed': 'read failed',
};

/**
 * A blocker as `#n`, or as `owner/repo#n` when another repository's; `short` drops the owner, to fit on a button. A
 * Dependency goes by its owner.
 */
export const blockerRef = (
    item: Pick<Item, 'repo'>,
    b: Pick<Blocker, 'number' | 'repo' | 'title' | 'dependency'>,
    short = false,
): string =>
    b.dependency
        ? short
            ? b.dependency.owner
            : `Dependency on ${b.dependency.owner}`
        : !b.number
          ? (b.title ?? 'untracked work')
          : b.repo === item.repo
            ? `#${b.number}`
            : `${short ? b.repo.slice(b.repo.indexOf('/') + 1) : b.repo}#${b.number}`;

/** The item's open blockers, each as blockerRef gives it. */
export const openBlockerRefs = (item: Pick<Item, 'blockers' | 'repo'>, short = false): string[] =>
    openBlockers(item).map((b) => blockerRef(item, b, short));

/**
 * The blockers in the two groups the board names, `blockers` defaulting to the item's open ones: the work that must
 * complete, as `#12, #13`, and the Dependencies the user must mark met, as `the Dependency on acme/auth`. Each says
 * whether it names more than one; a group with none is null.
 */
export function blockerGroups(item: Pick<Item, 'blockers' | 'repo'>, blockers = openBlockers(item)) {
    const work = blockers.filter((b) => !b.dependency).map((b) => blockerRef(item, b));
    const owners = blockers.flatMap((b) => (b.dependency ? [b.dependency.owner] : []));

    return {
        work: work.length ? { names: work.join(', '), many: work.length > 1 } : null,
        dependencies: owners.length
            ? {
                  names: `the ${owners.length > 1 ? 'Dependencies' : 'Dependency'} on ${owners.join(', ')}`,
                  many: owners.length > 1,
              }
            : null,
    };
}

/** Why the item can't start while a blocker's work isn't complete or a Dependency isn't met, naming each; null once none is left. */
export function blockedText(item: Pick<Item, 'blockers' | 'repo'>): string | null {
    const { work, dependencies } = blockerGroups(item);
    const parts = [
        ...(work ? [`${work.names} until ${work.many ? 'they complete' : 'it completes'}`] : []),
        ...(dependencies ? [`${dependencies.names} until you mark ${dependencies.many ? 'them' : 'it'} met`] : []),
    ];

    return parts.length ? `Blocked by ${parts.join(', and by ')}` : null;
}

/**
 * What the board asks the user about a Dependency: to review a met mark whose observation changed since, or to mark an
 * unmet one met when its ticket closed or a PR merged. Null when nothing asks. The board never changes the mark itself.
 */
export function dependencyNotice(d: DependencyHold): string | null {
    const seen = d.observation;

    if (!seen) return null;

    const subject = `Its ${seen.subject === d.ticket ? 'ticket' : 'PR'} ${seen.subject}`;

    if (d.met)
        return d.needsReview
            ? `${subject} changed to ${DEPENDENCY_OBSERVATION_WORDS[seen.kind]} after you marked it met. Review the mark.`
            : null;

    return seen.kind === 'closed' || seen.kind === 'merged'
        ? `${subject} is ${seen.kind}. Mark it met once the change is delivered.`
        : null;
}

/** T3's offered model label, with the same readable fallback for a model no longer offered. */
export function modelDisplayName(groups: readonly ModelGroup[], slug: string): string {
    const offered = groups.flatMap((group) => group.models).find((model) => model.slug === slug);

    return (
        offered?.label ??
        slug
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase())
            .replace(/^Gpt\b/, 'GPT')
            .replace(/(\d) (\d)/g, '$1.$2')
    );
}

/**
 * The Project default in T3 entry's second line: the model and effort T3 will use, or nothing when that can't be read. T3 stores no
 * option for a value equal to the model's default, so T3 then uses that default, such as medium on Opus 5.5. The board
 * can't read it, so the line names the model alone. No effort here never means low.
 */
export function t3DefaultDetail(
    groups: readonly ModelGroup[],
    selection: ModelSelection | undefined,
): string | undefined {
    if (!selection) return undefined;

    const group = groups.find((g) => g.instanceId === selection.instanceId);
    const model = group?.models.find((m) => m.slug === selection.model)?.label ?? selection.model;
    const effort = selection.options?.find((o) => o.id === 'effort' || o.id === 'reasoningEffort')?.value;
    const name = `${group?.name ?? selection.instanceId} ${model}`;

    return typeof effort === 'string' ? `${name}, ${effort}` : name;
}

/** Why Start build and Start refining are held for a repository still onboarding. */
export const WAITS_FOR_ONBOARDING = 'Waits for onboarding to finish';

/**
 * Why a start in the repository is held, whatever the case: its onboarding's PR hasn't merged, or T3 has no project
 * for it; null when nothing holds it.
 */
export function startHold(
    data: Pick<BoardData, 'onboarding' | 'repositoryProjects'>,
    repo: string | null,
): string | null {
    if (isOnboarding(data, repo)) return WAITS_FOR_ONBOARDING;

    return repositoryProjectHint(data, repo);
}

/** How the board names a decision's method: Grill, Prototype, Research or Task, or No method for anything else. */
export function methodName(method: string | null): string {
    if (method === 'grill') return 'Clarification';

    return method && ['grill', 'prototype', 'research', 'task'].includes(method)
        ? `${method.charAt(0).toUpperCase()}${method.slice(1)}`
        : 'No method';
}

/** A decision's method as `methodName` gives it; null for any other kind of item. */
export const decisionMethodName = (item: Item): string | null =>
    item.kind === 'decision' ? methodName(decisionType(item)) : null;

/** Current PR evidence takes precedence over a recorded merge stage. No evidence cannot promise a merge. */
export function prReadiness(
    item: Pick<Item, 'status' | 'linkedPrs'>,
): { word: string; action: string; state: 'ready' | 'active' | 'waiting' | 'failed' | 'off' } | null {
    if (item.status !== 'Ready to merge' && item.status !== 'Verify') return null;

    const pr = item.linkedPrs[0];

    if (!pr || pr.pipelineUnread) return { word: 'Review PR', action: 'Review PR', state: 'off' };

    if (pr.state === 'merged') return { word: 'Merged', action: 'Review PR', state: 'ready' };

    if (pr.checkProgress && pr.checkProgress.state !== 'current')
        return { word: 'Review PR', action: 'Review PR', state: 'off' };

    if (pr.checks?.failed) return { word: 'Checks failed', action: 'Review failed checks', state: 'failed' };

    if (pr.state !== 'open' || pr.isDraft || pr.mergeState === 'blocked' || pr.mergeState === 'conflicts')
        return {
            word: pr.mergeState === 'conflicts' ? 'Resolve conflicts' : 'Review PR',
            action: 'Review PR',
            state: 'waiting',
        };

    if (pr.checks?.running || pr.mergeState === 'checking')
        return {
            word: pr.checks?.running ? 'Checks running' : 'Checking mergeability',
            action: 'Review PR',
            state: 'active',
        };

    if (pr.checks && pr.checks.total > pr.checks.passed + pr.checks.failed + pr.checks.running)
        return { word: 'Checks unknown', action: 'Review PR', state: 'off' };

    return null;
}

/** The same checks phrase in cards, PR rows and dialogs; failure takes precedence while other checks run. */
export function checksPhrase(checks: Checks | null): string {
    return !checks
        ? 'Checks not reported'
        : checks.failed
          ? 'Checks failed'
          : checks.running
            ? 'Checks running'
            : checks.passed === checks.total
              ? 'Checks passed'
              : 'Checks unknown';
}

/** The name of the item's repository as the board shows it. */
export const itemRepoNames = (item: Pick<Item, 'repo'>, repos: readonly RepoConfig[]): string =>
    repoName(repoKey(item), repos);

/**
 * A repository's key as the board shows it, each part decoded: `contoso/Fabrikam%20Fiber/lar-api` shows as
 * `contoso/Fabrikam Fiber/lar-api`. The key itself stays encoded, for matching and URLs.
 */
export const shownRepo = (repo: string): string => repo.split('/').map(decodePart).join('/');

/**
 * A repository's shown name: the part after the last `/` of `owner/name` or `organization/project/repository`, or all
 * of it when another of `repos` has the same name; decoded, as `shownRepo` shows it.
 */
export function repoName(key: string, repos: readonly RepoConfig[]): string {
    if (!key.includes('/')) return key;

    const nameOf = (repo: string) => repo.split('/').at(-1);
    const name = nameOf(key)!;

    return shownRepo(repos.some((r) => !sameRepo(r.repo, key) && nameOf(r.repo) === name) ? key : name);
}

/** The item's shortest name: its ticket's number, `#12`, or its title while it has no ticket. */
export function ref(item: Pick<Item, 'number' | 'title'>): string {
    return item.number ? `#${item.number}` : item.title;
}

/** The item's name in a sentence: `#12 Title`, or the title alone while it has no ticket. */
export function itemName(item: Pick<Item, 'number' | 'title'>): string {
    return item.number ? `#${item.number} ${item.title}` : item.title;
}

/** Delivery needs both permissions; reading and shaping remain independent. */
export function buildAccessProblem(
    access: Partial<Record<'push-branch' | 'open-pr', OperationAccess>> = {},
): string | null {
    const missing = (
        [
            ['push-branch', 'push branches'],
            ['open-pr', 'open pull requests'],
        ] as const
    )
        .filter(([operation]) => access[operation] !== 'allowed')
        .map(([, name]) => name);

    return missing.length
        ? `Builds need verified access to ${missing.join(' and ')}. Recheck Project access in Settings.`
        : null;
}

export function buildActivity(item: Item, stale = false, start?: StartProgress): { label: string; running: boolean } {
    if (start?.phase === 'starting') return { label: 'Starting', running: false };

    if (start?.phase === 'may-have-started') return { label: 'May have started', running: false };

    if (workingAgain(item, stale)) return { label: 'Working', running: true };

    if (!['In progress', 'Review', 'Ready'].includes(item.status)) return { label: item.status, running: false };

    const current = currentBuildThread(item);

    if (stale || item.paused || item.archived || item.needsYou)
        return { label: 'Activity unavailable', running: false };

    const running = !!current?.currentRunning || delegatedWorkRunning(item);

    if (!current && !running) return { label: 'Activity unavailable', running: false };

    if (!running)
        return {
            label:
                current?.state === 'stopped'
                    ? 'Stopped'
                    : current?.state === 'needs you'
                      ? 'Needs you'
                      : 'Activity unavailable',
            running: false,
        };

    // A builder can still be integrating or checking after its last slice finishes, before it records the next phase.
    if (
        item.buildPhase === 'implement' &&
        item.slices?.length > 0 &&
        item.slices.every((slice) => slice.progress === 'done')
    ) {
        return { label: 'Finishing build', running };
    }

    return { label: BUILD_PHASE_WORDS[item.buildPhase ?? ''] ?? 'Working', running };
}

const BUILD_PHASE_WORDS: Record<string, string> = {
    plan: 'Planning',
    implement: 'Implementing',
    review: 'Review',
    checks: 'Checks',
    'full-checks': 'Checks',
    'domain-docs': 'Updating docs',
    approve: 'Awaiting approval',
    retro: 'Retro',
};

/** The recorded build phase in the same words as current activity. */
export const buildPhaseLabel = (phase: string | null | undefined): string | undefined =>
    phase ? (BUILD_PHASE_WORDS[phase] ?? phase) : undefined;
