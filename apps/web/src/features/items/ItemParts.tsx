// The bits every view draws for an item: its numbered title, title link, kind badge and label chips, and the item
// dialog's repository tag. The tag is the design system's Badge, with the repository's project icon. Slices, pull
// requests, agent work and activity have files of their own.

import { decisionMethodName, itemRepoNames, ref, labelsOnRow, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { AzureWorkItem, Item, Kind, RepoConfig } from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import { ArrowLeftRight, Bug, Lightbulb, Sparkles, TrendingUp, type LucideIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

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
                <Badge key={label} data-label-chip className="max-w-full" labelColor={item.labelColors?.[label]}>
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
