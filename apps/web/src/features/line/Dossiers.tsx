// The dock, Concepts and linked work: each started concept, and each open item with sub-issues on the board, as a row:
// its source, repository, kind and title with any other repositories, its most important chip (parts that need you, open
// decisions, blocked slices, whether it is refined, fog) in a stage row's state column, and its Start and an expanded row's
// view controls in the action slot, then a second line of its part bar, parts done, what's next and agent figures, in the
// columns the board's stage rows keep. Its chevron expands it in place under that same line, in the page's scroll, on its Work map,
// with the concept's own question above and its Dependencies and fog below. Its parts list instead lists what keeps the
// work moving (parts that need you, parts to verify or merge, open decisions, blocked slices, waiting parts, parts ready to
// start, Dependencies and fog) or says nothing holds it up, then each part with what it asks next, its stage track, figures,
// thread and slices, the done parts folded away. The browser remembers which dossiers are expanded and which view each shows.

import { itemName, repoKey } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';
import type { MouseEvent } from 'react';

import { Attention } from './Attention';
import { open, type FindRef } from './DossierHelpers';
import { DossierLine } from './DossierLine';
import { unreadParts, unreadPartsText } from './DossierParts';
import type { DossierItems, Part } from './DossierParts';
import { NO_DELIVERY, noDelivery } from './DossierSummary';
import { ViewToggle, LocalPlanning } from './DossierTools';
import { Pane } from './Pane';
import { PartsList } from './PartsList';
import { OPEN, VIEW, useStored } from './useStored';
import type { View } from './useStored';
import { WorkMap } from './WorkMap';
import { ItemStatusGlyph, OpenThread, StructureSync } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { DossierBody as Body, DossierList, DossierRow as Row, DossierToggle, RowGlyph } from '@/ui/board';

/** What the Work map can't draw: the concept's own question over it, what it depends on and doesn't know yet under it. */
const ABOVE_MAP = ['you'];
const BELOW_MAP = ['dependencies', 'fog'];

/** What an expanded dossier holds, at its natural height: its parts as a Work map or a list, with what keeps them moving. */
function DossierBody({ parent, parts, data, view }: { parent: Item; parts: Part[]; data: BoardData; view: View }) {
    const find: FindRef = (repo = parent.repo ?? '', n) =>
        data.items.find((i) => i.number === n && i.repo?.toLowerCase() === repo.toLowerCase());
    const missing = unreadParts(parent, parts);
    // The line's own label says the planning is local; a spec waiting to save still speaks up here.
    const { sync: _, ...unsynced } = parent;

    return (
        <Body>
            {noDelivery(parent) && (
                <Text variant="caption" tone="muted" data-no-delivery>
                    {NO_DELIVERY}
                </Text>
            )}
            {missing > 0 && (
                <Text variant="caption" tone="muted" data-unread-parts>
                    {unreadPartsText(missing)}.
                </Text>
            )}
            <StructureSync item={unsynced} />
            {view === 'map' ? (
                <>
                    <Attention parent={parent} parts={parts} data={data} find={find} only={ABOVE_MAP} />
                    <WorkMap parts={parts} check={parent.map?.check} data={data} home={repoKey(parent)} />
                    <Attention parent={parent} parts={parts} data={data} find={find} only={BELOW_MAP} />
                </>
            ) : (
                <>
                    <Attention parent={parent} parts={parts} data={data} find={find} />
                    <PartsList parts={parts} data={data} home={repoKey(parent)} />
                </>
            )}
        </Body>
    );
}

/** A dossier in the dock: the title opens the item; the chevron, or anywhere else on the line but its controls, expands it in place. */
function DossierRow({ parent, parts, data }: { parent: Item; parts: Part[]; data: BoardData }) {
    const [on, setOn] = useStored(OPEN, parent);
    const [view, setView] = useStored(VIEW, parent);
    const orphanPart =
        parent.kind !== 'concept' && !!(parent.parentId || parent.parent) && !parts.length && !parent.subIssues.total;
    // Letting go of a drag that selected text in the line leaves it as it was; a selection elsewhere on the page still toggles it.
    const toggle = (e: MouseEvent<HTMLDivElement>) => {
        const selection = window.getSelection();

        if (selection && !selection.isCollapsed && e.currentTarget.contains(selection.anchorNode)) return;

        setOn(!on);
    };
    const lead = (
        <DossierToggle
            open={on}
            label={`${on ? 'Collapse' : 'Expand'} ${itemName(parent)}`}
            onToggle={() => setOn(!on)}
        />
    );

    return (
        <Row id={parent.id} label={itemName(parent)}>
            <DossierLine
                parent={parent}
                parts={parts}
                data={data}
                lead={
                    orphanPart ? (
                        <RowGlyph>
                            <ItemStatusGlyph item={parent} />
                        </RowGlyph>
                    ) : (
                        lead
                    )
                }
                onClick={orphanPart ? () => open(parent) : toggle}
                note={!orphanPart && on && <LocalPlanning item={parent} />}
                tools={
                    orphanPart ? (
                        <OpenThread item={parent} data={data} />
                    ) : (
                        on && <ViewToggle view={view} onView={setView} />
                    )
                }
            />
            {!orphanPart && on && <DossierBody parent={parent} parts={parts} data={data} view={view} />}
        </Row>
    );
}

/** The dossiers the filters leave; a dossier follows its parent's row. With none, the dock takes no height. */
export function Dossiers({ dossiers }: { dossiers: DossierItems[] }) {
    const data = useBoardStore((state) => state.data);

    if (!dossiers.length) return null;

    return (
        <Pane id="dock" title="Concepts and linked work" count={dossiers.length}>
            <DossierList>
                {dossiers.map(({ parent, parts }) => (
                    <DossierRow key={parent.id} parent={parent} parts={parts} data={data} />
                ))}
            </DossierList>
        </Pane>
    );
}
