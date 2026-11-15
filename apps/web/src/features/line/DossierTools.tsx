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

/** A concept whose planning on this Mac failed to save speaks up beside its title; planning kept on this Mac as usual
 *  says so only in the source mark's tooltip, so the line doesn't shift when the row opens. */
export function LocalPlanning({ item }: { item: Item }) {
    if (item.sync?.state !== 'error' && item.sync?.state !== 'conflict') return null;

    const note = ['Planning is saved on this Mac.', item.sync.message].filter(Boolean).join(' ');

    return (
        <PlanningNote note={note} role="status">
            On this Mac
        </PlanningNote>
    );
}
