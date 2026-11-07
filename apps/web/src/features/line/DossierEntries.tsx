// The entries of a dossier's rows: text whose references open their items, a part's name and link, and an attention entry.

import { itemName } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { open } from './DossierHelpers';
import type { FindRef } from './DossierHelpers';
import type { Part } from './DossierParts';
import { ROW_OPENS } from './StageTrack';
import { ItemTitle, SourceIcon, ItemStatusGlyph } from '@/features/items';

/** Text with its `#n` and `owner/repo#n` references as buttons that open the item. */
export function Refs({ text, find }: { text: string; find: FindRef }) {
    return text.split(/((?:[\w.-]+\/[\w.-]+)?#\d+)/).map((bit, n) => {
        const ref = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(bit);
        const item = ref ? find(ref[1], Number(ref[2])) : undefined;

        return item ? (
            <button
                key={n}
                type="button"
                onClick={() => open(item)}
                title={item.title}
                className="rounded px-0.5 font-medium text-(--primary) tabular-nums hover:bg-(--accent)"
            >
                {bit}
            </button>
        ) : (
            bit
        );
    });
}

/** A part's source, status and title, up to two lines. */
export function PartName({ part }: { part: Part }) {
    return (
        <span className="flex min-w-0 items-start gap-1.5 text-sm">
            <SourceIcon item={part.item} />
            <span className="mt-0.5 inline-flex">
                <ItemStatusGlyph item={part.item} className="size-3.5" />
            </span>
            <span className="line-clamp-2">
                <ItemTitle item={part.item} />
            </span>
        </span>
    );
}

/** A part as a link to its item dialog. */
export function PartLink({ part }: { part: Part }) {
    return (
        <button
            type="button"
            onClick={() => open(part.item)}
            title={itemName(part.item)}
            className={`min-w-0 rounded text-left hover:underline ${ROW_OPENS}`}
        >
            <PartName part={part} />
        </button>
    );
}

/** One entry of an attention row, with what it waits on or its next action at the right. */
export function Entry({ main, side }: { main: ReactNode; side?: ReactNode }) {
    return (
        <div className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md px-2 py-1.5 hover:bg-(--soft)">
            <span className="min-w-0 flex-1 basis-64">{main}</span>
            {side && <span className="ml-auto shrink-0 text-xs text-(--muted-foreground)">{side}</span>}
        </div>
    );
}
