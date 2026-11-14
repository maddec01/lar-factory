import { comparePartOrder } from '@lar-factory/shared';
import type { BoardData, EndToEndCheck } from '@lar-factory/shared';

import { DECISION_KINDS } from './DossierParts';
import type { Part } from './DossierParts';
import type { layout } from './WorkMapLayout';
import { CheckNode, PartNode, RepoIdentity } from './WorkMapParts';
import { MapLaneName, MapPrerequisiteNode, MapStack, MapStackItem } from '@/ui/board';

/** The same map cards in dependency order, so a phone never opens on an empty graph column. */
export function CompactWorkMap({
    map,
    width,
    check,
    data,
    home,
}: {
    map: ReturnType<typeof layout>;
    width: number;
    check: EndToEndCheck | undefined;
    data: BoardData;
    home: string;
}) {
    const cardWidth = Math.max(0, width - 24);
    const ordered = [...map.placed].sort(
        (a, b) =>
            a.col - b.col ||
            (a.part && b.part && (a.part.item.createdAt || b.part.item.createdAt)
                ? comparePartOrder(a.part.item, b.part.item)
                : a.y - b.y),
    );
    const title = (key: string) => {
        const node = map.placed.find((node) => node.key === key);

        return node?.part?.item.title ?? node?.prerequisite?.blocker.title ?? 'Completed parts';
    };
    const label = (part: Part) =>
        DECISION_KINDS.includes(part.kind) ? (
            <MapLaneName lane="decisions">Decisions</MapLaneName>
        ) : (
            <RepoIdentity repo={part.item.repo} data={data} />
        );

    return (
        <MapStack>
            {ordered.map((node) => (
                <MapStackItem
                    key={node.key}
                    label={node.part ? label(node.part) : node.prerequisite ? 'Prerequisite' : 'Outcome check'}
                    after={map.edges
                        .filter((edge) => edge.to === node.key)
                        .map((edge) => title(edge.from))
                        .join(', ')}
                >
                    {node.prerequisite ? (
                        <MapPrerequisiteNode prerequisite={node.prerequisite} width={cardWidth} />
                    ) : node.part ? (
                        <PartNode part={node.part} data={data} width={cardWidth} home={home} />
                    ) : check ? (
                        <CheckNode check={check} width={cardWidth} after="" />
                    ) : null}
                </MapStackItem>
            ))}
        </MapStack>
    );
}
