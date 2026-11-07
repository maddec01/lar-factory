// The bits every view draws for an item: its numbered title, title link, kind badge and label chips, and the item
// dialog's repository tag. The tag is the design system's Badge, with the repository's project icon. Slices, pull
// requests, agent work and activity have files of their own.

import { decisionMethodName, itemRepoNames, ref, labelsOnRow, repoKey, repoName, shortAgo } from '@lar-factory/shared';
import type { AzureWorkItem, Item, Kind, RepoConfig } from '@lar-factory/shared';
import {
    Badge,
    ItemBadges,
    ItemFields,
    ItemTitle as DesignItemTitle,
    KindMarker as DesignKindMarker,
    LabelChip,
    RepoIdentity,
    RepoTag as DesignRepoTag,
    ItemNote,
    TitleLink as DesignTitleLink,
} from '@lar-works/design-system';
import { Bug, Lightbulb, Sparkles, TrendingUp, type LucideIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';

/** The control room's repository badge, with a medium label. */
export function RepoTag({ repo, repos }: { repo: string; repos: readonly RepoConfig[] }) {
    return <DesignRepoTag icon={<ProjectIcon repo={repo} size="small" />} name={repoName(repo, repos)} />;
}

/** A row's repository: its project icon and name. Where the ticket is saved is SourceIcon's to say, beside it. */
export function RepoCell({ item }: { item: Item }) {
    const repos = useBoardStore((state) => state.data.repos);

    return (
        <RepoIdentity
            data-repo-cell
            icon={<ProjectIcon repo={repoKey(item)} size="small" />}
            name={itemRepoNames(item, repos)}
        />
    );
}

/** The item's numbered title as a link to its ticket, or as text when it has no page, as a sentence names it. */
export function TitleLink({ item }: { item: Item }) {
    return (
        <DesignTitleLink
            reference={item.number ? ref(item) : undefined}
            title={item.title}
            href={item.url ?? undefined}
        />
    );
}

/** An item's title with its ticket's number before it, muted, the way the board lists every item; captured work has no number. */
export function ItemTitle({ item }: { item: Item }) {
    return <DesignItemTitle reference={item.number ? ref(item) : undefined} title={item.title} />;
}

/** Azure's type, state and assignee as one compact line beside factory status. */
export function AzureFields({ azure }: { azure: AzureWorkItem | undefined }) {
    if (!azure) return null;

    const text = [azure.type, azure.state, azure.assignee].filter(Boolean).join(' · ');

    return <ItemFields data-azure text={text} />;
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

    return <DesignKindMarker data-kind-marker said={said} label={sentence} title={`${sentence} Open to choose.`} />;
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
                <LabelChip key={label} label={label} color={item.labelColors?.[label]} />
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
        <ItemBadges data-item-kind>
            <KindBadge kind={item.kind} />
            {onRow && <KindMarker item={item} />}
            {words.map((word) => (
                <Badge key={word}>{word}</Badge>
            ))}
        </ItemBadges>
    ) : null;
}

export function StructureSync({ item }: { item: Item }) {
    return (
        <>
            {item.specSync && (
                <ItemNote data-spec-sync role="status">
                    {item.specSync.warning ?? item.specSync.error ?? 'Spec waiting to save to tracker'}
                </ItemNote>
            )}
            {item.sync && item.sync.state !== 'saved' && (
                <ItemNote
                    data-structure-sync
                    title={item.sync.message}
                    role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : undefined}
                >
                    Planning is saved on this Mac.
                </ItemNote>
            )}
        </>
    );
}

/** How long ago `at` was. It alone follows the clock, so a tick renders nothing around it. */
export const Age = ({ at }: { at: string }) => <>{useBoardStore((state) => shortAgo(at, state.now))}</>;
