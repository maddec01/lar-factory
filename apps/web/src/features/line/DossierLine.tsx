// A dossier's one line in the dock: its identity, first chip and Start, then its parts bar, what's next and figures.

import type { BoardData, Item } from '@lar-factory/shared';
import { deskParentName, itemActivityStill, itemName } from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

import { Figures, RowSecondLine } from './Columns';
import { DossierActivity, DossierState } from './DossierActivity';
import { open, usePicked } from './DossierHelpers';
import type { Part } from './DossierParts';
import { isDone, threadsOf } from './DossierParts';
import type { Chip, Moving } from './DossierSummary';
import { chipsOf, moving, nextOf, otherRepos, rowTooltip } from './DossierSummary';
import { PartStart } from './PartStart';
import { figuresOf } from './RowDetails';
import { RowKind, RowSource } from './RowIdentity';
import { stageOf } from './StageStatus';
import {
    ConceptBuild,
    AzureFields,
    ItemTitle,
    shownStatus,
    useShownStatus,
    STATUS_COLOR,
    useActivityUnavailable,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    boardColor,
    DossierChips,
    DossierFields,
    DossierLine as Line,
    DossierNext,
    DossierNote,
    DossierParentContext,
    DossierStates,
    DossierRepos,
    DossierTitle,
    DossierTitleCell,
    DossierTools,
    PartsBar as DesignPartsBar,
    RowCells,
    RowCount,
    RowFirst,
    RowKindCell,
    RowSide,
    RowStateCell,
} from '@/ui/board';

/** Every part as a segment in its status colour, done first, so the bar fills left to right; a dashed one per part the board doesn't read. */
function PartsBar({ m }: { m: Moving }) {
    const order = [...m.parts].sort(
        (a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status),
    );
    const unread = m.count - m.parts.length;
    const unavailable = useActivityUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);

    return (
        <DesignPartsBar
            title={`${m.done}/${m.count} parts done`}
            unread={unread}
            parts={order.map((p) => {
                const { word, glyph } = shownStatus(p.item, unavailable);

                return {
                    key: p.item.id,
                    title: `${itemName(p.item)}: ${isDone(p.item) ? 'Complete' : word}`,
                    // oxlint-disable-next-line react/purity -- the pulse reads the time as of this render; board updates render the bar again
                    pulse: glyph === 'In progress' && !itemActivityStill(p.item, Date.now(), disconnected),
                    color: isDone(p.item)
                        ? boardColor.done
                        : glyph === 'Queued' || glyph === 'List'
                          ? boardColor.empty
                          : STATUS_COLOR[glyph],
                };
            })}
        />
    );
}

/** Every chip names its state; none collapse into an unexplained count. An empty dossier takes no room. */
function Chips({ chips }: { chips: Chip[] }) {
    const [first, ...rest] = chips;

    if (!first) return null;

    return <DossierChips first={first} more={rest.map((c) => c.words)} />;
}

/** Next, as a sentence. */
function Next({ n, parent }: { n: ReturnType<typeof nextOf>; parent: Item }) {
    const shown = useShownStatus(n.part?.item ?? parent);
    const word = { you: shown.word, start: 'Next', moving: 'Moving', none: '' }[n.tone];

    return <DossierNext word={word} yours={n.tone === 'you'} unseen={n.tone === 'start'} text={n.text} />;
}

/** A dossier's one line in the dock; `lead` takes the glyph's column of a stage row, `note` follows its title, and `tools`, an expanded dossier's view controls, sit in the action slot beside any Start. */
export function DossierLine({
    parent,
    parts,
    data,
    lead,
    note,
    tools,
    onClick,
}: {
    parent: Item;
    parts: Part[];
    data: BoardData;
    lead: ReactNode;
    note?: ReactNode;
    tools?: ReactNode;
    onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}) {
    const isPicked = usePicked(parent);
    const m = moving(parent, parts, useActivityUnavailable());
    const threads = [parent, ...parts.map((p) => p.item)].flatMap(threadsOf);
    const chips = chipsOf(parent, m);
    const n = nextOf(m, parent);
    const repos = otherRepos(parent, m, data);
    const partOf = deskParentName(parent, data.items);
    const hasParent = !!(parent.parentId || parent.parent);
    const parentOutside = hasParent && !data.items.some((item) => item.id === parent.parentId);
    const parentContext = hasParent
        ? `Part of ${partOf ?? 'a parent outside the board'}${parentOutside ? ' · Parent is outside the board' : ''}`
        : undefined;

    return (
        <Line item={parent.id} picked={isPicked} title={rowTooltip(chips, threads)} onClick={onClick}>
            <RowFirst>
                <RowCells>
                    {lead}
                    <RowSource item={parent} />
                    <RowKindCell>
                        {parent.kind === 'concept' || hasParent ? (
                            <RowKind item={parent} />
                        ) : (
                            <Badge tone="neutral">Linked work</Badge>
                        )}
                    </RowKindCell>
                    <DossierTitleCell>
                        <DossierTitle name={parent.title} onOpen={() => open(parent)}>
                            <ItemTitle item={parent} />
                        </DossierTitle>
                        <DossierFields>
                            <AzureFields azure={parent.azure} />
                        </DossierFields>
                        <DossierNote>{note}</DossierNote>
                        <DossierRepos>{repos}</DossierRepos>
                    </DossierTitleCell>
                    {/* Every chip keeps its meaning visible. */}
                    <RowStateCell clips={false}>
                        <DossierStates>
                            <DossierState item={parent} />
                            <Chips chips={chips} />
                        </DossierStates>
                    </RowStateCell>
                </RowCells>
                {/* A click beside the controls toggles the row, as anywhere else on it. */}
                <RowSide passEmpty>
                    {tools && <DossierTools>{tools}</DossierTools>}
                    {parent.conceptBuild ? (
                        <ConceptBuild item={parent} compact />
                    ) : (
                        n.part && n.tone === 'start' && <PartStart part={n.part} data={data} />
                    )}
                </RowSide>
            </RowFirst>
            <RowSecondLine
                bar={m.count > 0 && <PartsBar m={m} />}
                figures={<Figures s={figuresOf(parent, data, true)} item={parent} total />}
                count={
                    (m.count > 0 || !hasParent || parent.kind === 'concept') && (
                        <RowCount title={m.count ? `${m.done}/${m.count} parts done` : undefined}>
                            {m.count ? `${m.done}/${m.count} parts` : 'No parts yet'}
                        </RowCount>
                    )
                }
            >
                {parentContext ? (
                    <DossierParentContext>{parentContext}</DossierParentContext>
                ) : (
                    <Next n={n} parent={parent} />
                )}
            </RowSecondLine>
            <DossierActivity item={parent} />
        </Line>
    );
}
