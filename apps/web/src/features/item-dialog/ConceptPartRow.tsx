// A concept dialog's part: its title led by its reference, then its project, agent figures and state in columns that line up down
// the list, Open thread taking the state's place on hover.

import { needsAnswer, shapingOwner } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';

import { ItemStatusGlyph, OpenThread, RepoCell, SourceIcon, useShownStatus } from '@/features/items';
import { Figures, figuresOf, isDone, partState, PartTitle, RowKindMark } from '@/features/line';
import { PartColumnsRow, PartName, WaitWord } from '@/ui/board';

export function ConceptPartRow({
    item,
    data,
    openPart,
    parentRepo,
}: {
    item: Item;
    data: BoardData;
    openPart: (itemId: string) => void;
    /** The concept's own repository, which a part in the same one doesn't repeat. */
    parentRepo: string | undefined;
}) {
    const shown = useShownStatus(item);
    const complete = isDone(item);
    const hasThread = item.threads === 'unavailable' || Boolean(item.threads?.length || shapingOwner(item, data.items));
    // Agent time, tokens and cost on the part's one line, in a column of their own, so they line up down the list.
    const usage = <Figures s={figuresOf(item, data)} item={item} full />;

    return (
        <PartColumnsRow
            id={item.id}
            title={item.title}
            onOpen={() => openPart(item.id)}
            name={
                <PartName
                    source={
                        <>
                            <RowKindMark item={item} />
                            <SourceIcon item={item} />
                        </>
                    }
                    glyph={<ItemStatusGlyph item={item} status={complete ? 'Done' : item.status} />}
                >
                    <PartTitle item={item} />
                </PartName>
            }
            project={item.repo !== parentRepo && <RepoCell item={item} />}
            cost={usage}
            state={
                !complete && (needsAnswer(item) || item.status === 'Needs you') ? (
                    <WaitWord>{shown.word}</WaitWord>
                ) : (
                    partState(item, data, shown.word)
                )
            }
            action={hasThread && <OpenThread item={item} data={data} part />}
        />
    );
}
