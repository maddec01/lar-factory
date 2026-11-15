// The board search's Settings matches: the first few, then More settings for the rest, so a query's items aren't
// buried under one project's settings.

import { matchingGroups } from './SearchOptions';
import type { SearchOption } from './SearchOptions';
import { conceptIcons } from '@/ui/board';

/** The most Settings matches listed before More settings. */
const MOST_SETTINGS = 3;

/** The `options` matching `query`: all of them once More settings was chosen (`all`), or with no `more` to choose it;
 *  else the first few, then More settings, which chooses `more` and moves the highlight to the first of the rest. */
export function settingMatches(
    options: SearchOption[],
    query: string,
    all: boolean,
    more: (() => void) | undefined,
): SearchOption[] {
    const matched = matchingGroups([{ label: 'Settings', options }], query)[0]?.options ?? [];
    const rest = matched.slice(MOST_SETTINGS);

    // One more is shown rather than named.
    if (all || rest.length < 2 || !more) return matched;

    return [
        ...matched.slice(0, MOST_SETTINGS),
        {
            value: 'settings:more',
            name: 'More settings',
            hint: `${rest.length} more`,
            icon: <conceptIcons.settings aria-hidden="true" />,
            select: () => {
                more();

                return rest[0]!.value;
            },
        },
    ];
}
