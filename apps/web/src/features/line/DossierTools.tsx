// An expanded dossier's line controls: its view toggle and where its planning lives.

import type { Item } from '@lar-factory/shared';
import { ViewToggle as DesignViewToggle } from '@lar-works/design-system';
import { ListChecks, Map as MapIcon } from '@lar-works/design-system/icons';

import type { View } from './useStored';
import { PlanningNote } from '@/ui/board';

/** Work map or parts list: one dossier's way of drawing its parts, as two small icon buttons named for assistive technology, in a group as tall as the row's line. */
export function ViewToggle({ view, onView }: { view: View; onView: (v: View) => void }) {
    return (
        <DesignViewToggle
            size="sm"
            value={view}
            onChange={onView}
            options={[
                { value: 'map', label: 'Work map', icon: <MapIcon /> },
                { value: 'list', label: 'Parts list', icon: <ListChecks /> },
            ]}
        />
    );
}

/** Where the concept's planning lives, as a quiet label; hovering or focusing it reads the whole note. */
export function LocalPlanning({ item }: { item: Item }) {
    if (!item.sync || item.sync.state === 'saved') return null;

    const note = ['Planning is saved on this Mac.', item.sync.message].filter(Boolean).join(' ');

    return (
        <PlanningNote
            note={note}
            role={item.sync.state === 'error' || item.sync.state === 'conflict' ? 'status' : 'note'}
        >
            On this Mac
        </PlanningNote>
    );
}
