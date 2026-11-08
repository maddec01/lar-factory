import { plural } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';
// Settings' General page: dialogs, threads, commands, Auto-build and refresh.

import { AutoBuildModelSetting } from './AutoBuildModel';
import { DialogPreference } from './DialogPreference';
import { LimitSetting } from './LimitSetting';
import { custom, type Group, type SettingsData } from './SettingsModel';
import { ShapingThreadCleanupSetting } from './ShapingThreadCleanup';
import { BUILD_LIMIT_NOTE } from '@/features/items';
import type { Control } from '@/shared/settings/SettingControls';

/** The board's current refresh interval, read-only. */
function refreshEvery(seconds: number): Control {
    const minutes = seconds / 60;
    const value = seconds < 60 || !Number.isInteger(minutes) ? plural(seconds, 'second') : plural(minutes, 'minute');

    return custom(() => (
        <Text variant="caption" tone="muted">
            {value}
        </Text>
    ));
}

export const generalGroups = (data: SettingsData): Group[] => [
    {
        title: 'Dialogs',
        rows: [
            {
                id: 'match-list-size',
                keywords: 'match List size Open items expanded',
                title: 'Open items full-size with List',
                description: 'Match the List’s window size when opening an item.',
                control: custom(() => (
                    <DialogPreference preference="matchList" label="Open items full-size with List" />
                )),
            },
            {
                id: 'open-list-expanded',
                title: 'Open List expanded',
                description: 'Use the full window when opening List.',
                control: custom(() => <DialogPreference preference="openList" label="Open List expanded" />),
            },
        ],
    },
    {
        title: 'Threads',
        rows: [
            {
                id: 'shaping-thread-cleanup',
                title: 'Shaping threads when a build starts',
                description: 'Choose whether to keep, finish, archive or delete the shaping thread.',
                help: 'Keep, finish, archive or delete the threads. Archived threads reopen from T3 Settings. Deleted threads leave the item’s usage totals; deletion can’t be undone.',
                control: custom(() => <ShapingThreadCleanupSetting state={data.shapingThreadCleanup} />),
            },
        ],
    },
    {
        title: 'Commands',
        rows: [
            {
                id: 'heavy-command-limit',
                title: 'Parallel tests and builds',
                description: 'Limit tests and builds running together across all projects on this Mac.',
                help: 'Automatic allows one per 4 CPUs or 8 GB of memory, whichever is fewer, with a minimum of one. Servers and file watchers don’t count toward this limit.',
                control: custom(() => (
                    <LimitSetting
                        name="heavy-command-limit"
                        label="Parallel tests and builds"
                        field="Heavy command limit"
                        state={data.heavyCommandLimit}
                    />
                )),
            },
            {
                id: 'build-limit',
                title: 'Automatic build limit',
                description: 'Pause automatic starts when this many builds are open.',
                help: `${BUILD_LIMIT_NOTE} Manual starts and Start after can exceed this limit. Automatic uses the parallel tests and builds limit.`,
                control: custom(() => (
                    <LimitSetting
                        name="build-limit"
                        label="Automatic build limit"
                        field="Build limit"
                        state={data.buildLimit}
                    />
                )),
            },
        ],
    },
    {
        title: 'Auto-build',
        rows: [
            {
                id: 'auto-build-model',
                title: 'Auto-build model',
                description:
                    'Used for automatic starts. Project default in T3 uses each project’s saved model and options. Turn Auto-build on in Ready to build.',
                help: 'Manual starts keep their own model choice.',
                control: custom(() => <AutoBuildModelSetting data={data} />),
            },
        ],
    },
    {
        title: 'Refresh',
        rows: [
            {
                id: 'refresh',
                title: 'Full refresh',
                description: 'Changes also arrive between full refreshes.',
                control: refreshEvery(data.refreshSeconds),
            },
        ],
    },
];
