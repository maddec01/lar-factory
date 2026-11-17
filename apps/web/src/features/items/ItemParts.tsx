import type { AzureWorkItem, Item, Kind } from '@lar-factory/shared';
// The bits every view draws for an item: its numbered title, title link, repository, kind badge and label chips. Slices,
// pull requests, agent work and activity have files of their own.
import { visibleKind, decisionMethodName, itemRepoNames, onAzure, ref, repoKey, shortAgo } from '@lar-factory/shared';
import { Inline, LabelChip, Text } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { KIND_BADGES } from './KindBadges';
import { type LabelledItem, useShownLabels } from './useShownLabels';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { ItemFields, ItemTitle as DesignItemTitle, KindBadge as HueBadge, QuietLabel, RepoIdentity } from '@/ui/board';

/** A row's or the item dialog's repository: its project icon and name, alike wherever it shows. Where the ticket is saved is SourceIcon's to say, beside it. A
 *  `home` one is the concept's own, which a part shares, quieter than a project of the part's own (items.css). */
export function RepoCell({ item, home = false }: { item: Item; home?: boolean }) {
    const repos = useBoardStore((state) => state.data.repos);

    return (
        <RepoIdentity
            data-repo-cell
            data-repo-home={home || undefined}
            icon={<ProjectIcon repo={repoKey(item)} size="md" />}
            name={itemRepoNames(item, repos)}
        />
    );
}

/** The item's numbered title as a link to its ticket, or as text when it has no page, as a sentence names it. */
export function TitleLink({ item }: { item: Item }) {
    return (
        <DesignItemTitle
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

/** The item's shown labels as quiet outlined chips with their tracker's colour dots, each named in its tooltip as its
 *  tracker's ("Azure DevOps tag: Blocked"), so a tag never reads as a board state. */
export function LabelChips({ item }: { item: LabelledItem }) {
    const tracker = item.repo && onAzure(item.repo) ? 'Azure DevOps tag' : 'GitHub label';

    return (
        <>
            {useShownLabels(item).map((label) => (
                <QuietLabel key={label} title={`${tracker}: ${label}`}>
                    <LabelChip label={label} color={item.labelColors?.[label]} />
                </QuietLabel>
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
    const shownKind = visibleKind(item);
    const inSummary = summaryKind !== undefined;
    const words: string[] = [];
    const method = decisionMethodName(item);

    // In the summary, its kind names a decision's method and a build.
    if (!inSummary) {
        if (method) words.push(method);
        else if (!onRow && !KIND_BADGES[shownKind]) words.push('Work');
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
        else if (item.parent)
            words.push(item.parent.number ? `Part of #${item.parent.number}` : 'Part of another issue');
    }

    if (item.tracker?.connections?.length || item.tracker?.dependencies?.length) words.push('Across Projects');

    const kind = inSummary ? summaryKind : KIND_BADGES[shownKind] && <KindBadge kind={shownKind} />;

    return kind || words.length ? (
        <Inline as="span" inline wrap space="tight" data-item-kind>
            {kind}
            {/* Relationships read as quiet words beside the kind's badge, so the badge stays the one coloured mark. */}
            {words.length > 0 && (
                <Text as="span" variant="caption" tone="muted">
                    {words.join(' · ')}
                </Text>
            )}
        </Inline>
    ) : null;
}

export function StructureSync({ item, localNote = true }: { item: Item; localNote?: boolean }) {
    return (
        <>
            {item.specSync && (
                <Text as="span" variant="caption" tone="muted" data-spec-sync role="status">
                    {item.specSync.warning ?? item.specSync.error ?? 'Publishing Spec…'}
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

/** How long ago `at` was, such as "3d ago"; with `says`, its tooltip says what happened then ("Added 3d ago"). It alone
 *  follows the clock, so a tick renders nothing around it. */
export function Age({ at, says }: { at: string; says?: string | undefined }) {
    const ago = useBoardStore((state) => shortAgo(at, state.now));

    return says ? <span title={`${says} ${ago}`}>{ago}</span> : <>{ago}</>;
}
