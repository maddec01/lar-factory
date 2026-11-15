// A settings page's empty state, one way everywhere: the design system's compact EmptyState as the one row of its
// group's panel, so an empty page reads as the same bordered card wherever it shows (Updates in a browser, an empty
// Archive).

import { EmptyState } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import type { Group } from './SettingsModel';

/** A group holding only an empty state: its `icon`, `title` and `description` in the group's bordered panel, under the
 *  group's `heading` when it has one. It says something rather than offering a setting, so search leaves it out. */
export function emptyGroup({
    id,
    heading = '',
    icon,
    title,
    description,
}: {
    /** The row's id. */
    id: string;
    /** The group's title, empty for none. */
    heading?: string;
    /** The empty state's icon, the page's own. */
    icon: ReactNode;
    /** What is empty, such as "No archived items yet". */
    title: string;
    /** Why, or where to look instead. */
    description: string;
}): Group {
    return stateGroup({
        id,
        heading,
        title,
        state: <EmptyState size="compact" icon={icon} title={title} description={description} />,
    });
}

/** A group holding only a state, such as an empty state, a loading line or a LoadFailed, as its panel's one row, under
 *  the group's `heading` when it has one; search leaves it out. */
export function stateGroup({
    id,
    heading = '',
    title,
    state,
}: {
    /** The row's id. */
    id: string;
    /** The group's title, empty for none. */
    heading?: string;
    /** The row's name, such as what is empty. */
    title: string;
    /** What the row shows. */
    state: ReactNode;
}): Group {
    return {
        title: heading,
        rows: [{ id, title, noteOnly: true, control: { type: 'row', render: () => state } }],
    };
}
