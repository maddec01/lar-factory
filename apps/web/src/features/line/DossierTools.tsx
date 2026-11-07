// An expanded dossier's line controls: its view toggle and where its planning lives.

import type { Item } from '@lar-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { ListChecks, Map as MapIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import type { View } from './useStored';

/** Work map or parts list: one dossier's way of drawing its parts, as two small icon buttons named for assistive technology, in a group as tall as the row's line. */
export function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
    const one = (v: View, icon: ReactNode, label: string) => (
        <button
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            title={label}
            className={`grid size-6 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-(--primary) ${view === v ? 'bg-(--card) text-(--foreground) shadow-xs' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}
        >
            {icon}
            <span className="sr-only">{label}</span>
        </button>
    );

    return (
        <div className="inline-flex rounded-lg bg-(--muted) p-0.5">
            {one('map', <MapIcon className="size-3.5" />, 'Work map')}
            {one('list', <ListChecks className="size-3.5" />, 'Parts list')}
        </div>
    );
}

/** Where the concept's planning lives, as a quiet label; hovering or focusing it reads the whole note. */
export function LocalPlanning({ item }: { item: Item }) {
    if (!item.sync || item.sync.state === 'saved') return null;

    const note = ['Planning is saved on this Mac.', item.sync.message].filter(Boolean).join(' ');

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : 'note'}
                    aria-label={note}
                    data-structure-sync
                    className="rounded whitespace-nowrap text-(--muted-foreground) focus-visible:outline-2 focus-visible:outline-(--primary)"
                >
                    On this Mac
                </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{note}</TooltipPopup>
        </Tooltip>
    );
}
