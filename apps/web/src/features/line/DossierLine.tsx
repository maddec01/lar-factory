// A dossier's one line in the dock: its identity, first chip and Start, then its parts bar, what's next and figures.

import type { BoardData, Item } from '@lar-factory/shared';
import { deskParentName, itemActivityStill, itemName } from '@lar-factory/shared';
import type { MouseEvent, ReactNode } from 'react';

import { ActivityLine } from './ActivityLine';
import { Figures } from './Columns';
import { DossierState, useDossierActivity } from './DossierActivity';
import { open, usePicked } from './DossierHelpers';
import type { Part } from './DossierParts';
import { isDone, threadsOf } from './DossierParts';
import type { Chip, Moving } from './DossierSummary';
import { chipsOf, moving, nextOf, otherRepos, rowTooltip } from './DossierSummary';
import { PartStart } from './PartStart';
import { figuresOf } from './RowDetails';
import { RowKindMark, RowSource } from './RowIdentity';
import { stageOf } from './StageStatus';
import {
    Age,
    ConceptBuild,
    ItemTitle,
    shownStatus,
    useShownStatus,
    STATUS_COLOR,
    useActivityUnavailable,
} from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import {
    boardColor,
    DossierChip,
    DossierChips,
    DossierLine as Line,
    DossierNext,
    DossierNote,
    DossierParentContext,
    DossierStates,
    DossierTitle,
    DossierTitleCell,
    DossierTools,
    PartsBar as DesignPartsBar,
    RowCells,
    RowCount,
    RowFirst,
    RowMeta,
    RowMetaEnd,
    RowProgress,
    RowSide,
} from '@/ui/board';

/** Every part as a segment in its status colour, done first, so the bar fills left to right; a dashed one per part the board doesn't read. */
export function PartsBar({ m }: { m: Moving }) {
    const order = [...m.parts].sort(
        (a, b) => Number(isDone(b.item)) - Number(isDone(a.item)) || stageOf(b.item.status) - stageOf(a.item.status),
    );
    const unavailable = useActivityUnavailable();
    const disconnected = useBoardStore((state) => !!state.clientError);

    return (
        <DesignPartsBar
            title={`${m.done}/${m.count} parts done`}
            done={m.done}
            total={m.count}
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
    const word = { you: n.waitLabel ?? shown.word, start: 'Next', moving: 'Moving', none: '' }[n.tone];

    // "Next" shows, quietly, so the part the owner can start reads as the concept's next step.
    return <DossierNext word={word} yours={n.tone === 'you'} strong={n.tone === 'start'} text={n.text} />;
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
    // The parent's own thread at work says what it does where its next step would be, as a lane row's does.
    const acts = useDossierActivity(parent);
    const repos = otherRepos(parent, m, data);
    const partOf = deskParentName(parent, data.items);
    const hasParent = !!(parent.parentId || parent.parent);
    const parentOutside = hasParent && !data.items.some((item) => item.id === parent.parentId);
    const parentContext = hasParent
        ? `Part of ${partOf ?? 'a parent outside the board'}${parentOutside ? ' · Parent is outside the board' : ''}`
        : undefined;

    const figures = figuresOf(parent, data, true);
    const runHeld = !!parent.conceptBuild?.holds.length && parent.conceptBuild.run?.state !== 'running';

    return (
        <Line
            item={parent.id}
            picked={isPicked}
            attention={m.needsYou.length > 0}
            title={rowTooltip(chips, threads)}
            onClick={onClick}
        >
            <RowFirst>
                <RowCells>
                    {lead}
                    <DossierTitleCell>
                        {/* Source and project, then kind and title, as on a lane row. */}
                        <RowSource item={parent} always others={repos} />
                        <RowKindMark item={parent} />
                        <DossierTitle name={parent.title} onOpen={() => open(parent)}>
                            <ItemTitle item={parent} />
                        </DossierTitle>
                        <DossierNote>{note}</DossierNote>
                        {/* Its most important chip reads on the title's line; what waits on you is the row's next step. */}
                        {n.tone !== 'you' && (
                            <DossierChip>
                                <Chips chips={chips.slice(0, 1)} />
                            </DossierChip>
                        )}
                    </DossierTitleCell>
                </RowCells>
                <RowMeta>
                    {/* What is going on, in one column: what its thread does, else what it belongs to, else its next
                        step, else a held run, else its state. */}
                    {acts ? (
                        <ActivityLine item={parent} />
                    ) : parentContext ? (
                        <DossierParentContext>{parentContext}</DossierParentContext>
                    ) : n.tone !== 'none' ? (
                        <Next n={n} parent={parent} />
                    ) : runHeld ? (
                        <span title="Concept builds are held. Open the concept to see why.">Build all held</span>
                    ) : (
                        <DossierStates>
                            <DossierState item={parent} />
                        </DossierStates>
                    )}
                    {(m.count > 0 || !hasParent || parent.kind === 'concept') && (
                        <RowProgress
                            bar={m.count > 0 && <PartsBar m={m} />}
                            count={
                                <RowCount title={m.count ? `${m.done}/${m.count} parts done` : undefined}>
                                    {m.count ? `${m.done}/${m.count} parts` : 'No parts yet'}
                                </RowCount>
                            }
                        />
                    )}
                    <RowMetaEnd
                        cost={<Figures s={figures} item={parent} total />}
                        age={<Age at={parent.updatedAt} />}
                    />
                </RowMeta>
                {/* A click beside the controls toggles the row, as anywhere else on it. */}
                <RowSide passEmpty>
                    {tools && <DossierTools>{tools}</DossierTools>}
                    {/* A concept's run offers Build all when it can act; while it's held, the part that can start
                        is the row's action instead. */}
                    {parent.conceptBuild && !runHeld ? (
                        <ConceptBuild item={parent} compact />
                    ) : (
                        n.part && n.tone === 'start' && <PartStart part={n.part} data={data} />
                    )}
                </RowSide>
            </RowFirst>
        </Line>
    );
}
