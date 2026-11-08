// A dossier's one line in the dock: its identity, first chip and Start, then its parts bar, what's next and figures.

import type { BoardData, Item } from '@lar-factory/shared';
import { itemActivityStill, itemName } from '@lar-factory/shared';
import { Badge } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

import { Figures, RowSecondLine } from './Columns';
import { open, usePicked } from './DossierHelpers';
import type { Part } from './DossierParts';
import { isDone, threadsOf } from './DossierParts';
import type { Chip, Moving } from './DossierSummary';
import { chipsOf, moving, nextOf, otherRepos, rowTooltip } from './DossierSummary';
import { PartStart } from './PartStart';
import { figuresOf } from './RowDetails';
import { RowKind, RowSource } from './RowIdentity';
import { stageOf } from './StageStatus';
import { AzureFields, ItemTitle, shownStatus, STATUS_COLOR, useActivityUnavailable } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    boardColor,
    DossierChips,
    DossierFields,
    DossierLine as Line,
    DossierNext,
    DossierNote,
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

/** The first chip whole, and the rest in the line's tooltip. An empty dossier takes no room. */
function Chips({ chips }: { chips: Chip[] }) {
    const [first, ...rest] = chips;

    if (!first) return null;

    return <DossierChips first={first} more={rest.map((c) => c.words)} />;
}

/** Next, as a sentence. */
function Next({ n, badged }: { n: ReturnType<typeof nextOf>; badged: boolean }) {
    // A part on your desk is named as its attention row names it: Needs you, or to verify or merge.
    const yours =
        n.part?.item.status === 'Verify'
            ? 'To verify'
            : n.part?.item.status === 'Ready to merge'
              ? 'To merge'
              : 'Needs you';
    const word = { you: yours, start: 'Next', moving: 'Moving', none: '' }[n.tone];

    // Start sits in the action slot labelled "Start", and a "need you" badge says Needs you, so those words are
    // screen-reader text and leave their room to the title.
    return (
        <DossierNext
            word={word}
            yours={n.tone === 'you'}
            unseen={n.tone === 'start' || (badged && word === 'Needs you')}
            text={n.text}
        />
    );
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

    return (
        <Line item={parent.id} picked={isPicked} title={rowTooltip(chips, threads)} onClick={onClick}>
            <RowFirst>
                <RowCells>
                    {lead}
                    <RowSource item={parent} />
                    <RowKindCell>
                        {parent.kind === 'concept' ? (
                            <RowKind item={parent} />
                        ) : (
                            <Badge tone="neutral">Coupled work</Badge>
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
                    {/* The first chip keeps its full width; the rest of the chips wait in the tooltip. */}
                    <RowStateCell clips={false}>
                        <Chips chips={chips} />
                    </RowStateCell>
                </RowCells>
                {/* A click beside the controls toggles the row, as anywhere else on it. */}
                <RowSide passEmpty>
                    {tools && <DossierTools>{tools}</DossierTools>}
                    {n.part && n.tone === 'start' && <PartStart part={n.part} data={data} label="Start" />}
                </RowSide>
            </RowFirst>
            <RowSecondLine
                bar={<PartsBar m={m} />}
                figures={<Figures s={figuresOf(parent, data, true)} item={parent} total />}
                count={
                    <RowCount title={`${m.done}/${m.count} parts done`}>
                        {m.done}/{m.count} parts
                    </RowCount>
                }
            >
                <Next n={n} badged={m.needsYou.length > 0} />
            </RowSecondLine>
        </Line>
    );
}
