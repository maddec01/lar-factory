import type { AzureWorkItem, Item, Kind } from '@lar-factory/shared';
// The bits every view draws for an item: its numbered title, title link, repository, kind badge and label chips. Slices,
// pull requests, agent work and activity have files of their own.
import { decisionMethodName, itemRepoNames, ref, repoKey, shortAgo } from '@lar-factory/shared';
import { Badge, Inline, LabelChip, Text } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { KIND_BADGES } from './KindBadges';
import { type LabelledItem, useShownLabels } from './useShownLabels';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    ItemFields,
    ItemTitle as DesignItemTitle,
    KindBadge as HueBadge,
    RepoIdentity,
    TitleLink as DesignTitleLink,
} from '@/ui/board';

/** A row's or the item dialog's repository: its project icon and name, alike wherever it shows. Where the ticket is saved is SourceIcon's to say, beside it. */
export function RepoCell({ item }: { item: Item }) {
    const repos = useBoardStore((state) => state.data.repos);

    return (
        <RepoIdentity
            data-repo-cell
            icon={<ProjectIcon repo={repoKey(item)} size="sm" />}
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

/** A kind in its colour with its icon, then `children`; builds, decisions and tickets with no recognised kind have none. */
export function KindBadge({ kind, children }: { kind: Kind; children?: ReactNode }) {
    const badge = KIND_BADGES[kind];

    if (!badge) return null;

    const { name, icon: Icon, hue } = badge;

    return (
        <HueBadge data-kind-badge hue={hue}>
            <Icon aria-hidden="true" />
            {name}
            {children}
        </HueBadge>
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

/**
 * Kind and relationships remain visible before an issue is queued. `onRow` leaves out the word for work with no kind badge.
 * In the item dialog's summary, `summaryKind` names the kind in place of the badge, method and Work word (nothing when the
 * dialog's Kind control names it), and the summary's own "Part of" link names the parent, so each fact shows once.
 */
export function ItemKind({
    item,
    onRow = false,
    summaryKind,
}: {
    item: Item;
    onRow?: boolean;
    summaryKind?: ReactNode;
}) {
    const inSummary = summaryKind !== undefined;
    const words: string[] = [];
    const method = decisionMethodName(item);

    // In the summary, its kind names a decision's method and a build.
    if (!inSummary) {
        if (method) words.push(method);
        else if (!onRow && !KIND_BADGES[item.kind]) words.push('Work');
    }

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

    // The summary's "Part of" link names the parent already.
    if (!(inSummary && item.parent)) {
        if (parentIsConcept) words.push('Part of a concept');
        else if (item.parent) words.push('Part of another issue');
    }

    if (item.tracker?.connections?.length || item.tracker?.dependencies?.length) words.push('Across Projects');

    const kind = inSummary ? summaryKind : KIND_BADGES[item.kind] && <KindBadge kind={item.kind} />;

    return kind || words.length ? (
        <Inline as="span" inline wrap space="tight" data-item-kind>
            {kind}
            {words.map((word) => (
                <Badge key={word}>{word}</Badge>
            ))}
        </Inline>
    ) : null;
}

export function StructureSync({ item, localNote = true }: { item: Item; localNote?: boolean }) {
    return (
        <>
            {item.specSync && (
                <Text as="span" variant="caption" tone="muted" data-spec-sync role="status">
                    {item.specSync.warning ?? item.specSync.error ?? 'Spec waiting to save to tracker'}
                </Text>
            )}
            {localNote && item.sync && item.sync.state !== 'saved' && (
                <Text
                    as="span"
                    variant="caption"
                    tone="muted"
                    data-structure-sync
                    title={item.sync.message}
                    role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : undefined}
                >
                    Planning is saved on this Mac.
                </Text>
            )}
        </>
    );
}

/** How long ago `at` was. It alone follows the clock, so a tick renders nothing around it. */
export const Age = ({ at }: { at: string }) => <>{useBoardStore((state) => shortAgo(at, state.now))}</>;
