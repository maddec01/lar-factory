// The work map's nodes besides a part's card (ItemCard): the end-to-end check, and a finished part's row in the expanded
// history group, with the kind label and repository identity every map surface shows.

import type { BoardData, EndToEndCheck } from '@lar-factory/shared';
import { itemName, plural, prLabel, ref, repoKey, repoName, retiredPartLabel } from '@lar-factory/shared';

import type { Part } from './DossierParts';
import { threadsOf } from './DossierParts';
import { PartTitle } from './PartTitle';
import { RowKindMark } from './RowIdentity';
import { useItemDialogStore } from '@/features/item-dialog';
import { OpenThread, StatusGlyph } from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import {
    HistoryRow as DesignHistoryRow,
    MapCheckNode,
    PullRequestRef,
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
            icon={<ProjectIcon repo={repo} size="md" />}
            name={repoName(repo, data.repos)}
        />
    );
}

/** A finished part as one row of the expanded history group: its kind, title, what it followed, PR and thread when it has them. */
export function HistoryRow({ part, after, data }: { part: Part; after: Part[]; data: BoardData }) {
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
                    <MapRepo repo={repoKey(item)} data={data} />
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
