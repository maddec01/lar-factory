// Settings' General page: dialogs, threads, commands, Auto-build and refresh.

import { useState } from 'react';

import { AutoBuildModelSetting } from './AutoBuildModel';
import { LimitSetting } from './LimitSetting';
import { custom, type Group, type SettingsData } from './SettingsModel';
import { ShapingThreadCleanupSetting } from './ShapingThreadCleanup';
import { DIALOG_PREFERENCES, dialogPreference } from '@/shared/ui/expand-dialog/ExpandDialog';
import type { Control } from '@/shared/ui/setting-rows/SettingControls';
import { Switch } from '@/shared/ui/setting-rows/SettingControls';

function DialogPreference({ preference, label }: { preference: keyof typeof DIALOG_PREFERENCES; label: string }) {
    const [on, setOn] = useState(() => dialogPreference(preference));

    return (
        <Switch
            label={label}
            on={on}
            onChange={(next) => {
                localStorage.setItem(DIALOG_PREFERENCES[preference], next ? '1' : '0');
                setOn(next);
            }}
        />
    );
}

/** The board's current refresh interval, read-only. */
function refreshEvery(seconds: number): Control {
    const minutes = seconds / 60;
    const value =
        seconds < 60 || !Number.isInteger(minutes)
            ? `${seconds} seconds`
            : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;

    return custom(() => <span className="text-xs text-(--muted-foreground)">{value}</span>);
}

export const generalGroups = (data: SettingsData): Group[] => [
    {
        title: 'Dialogs',
        rows: [
            {
                id: 'match-list-size',
                title: 'Match list size when opening an item',
                control: custom(() => (
                    <DialogPreference preference="matchList" label="Match list size when opening an item" />
                )),
            },
            {
                id: 'open-list-expanded',
                title: 'Open list expanded',
                control: custom(() => <DialogPreference preference="openList" label="Open list expanded" />),
            },
        ],
    },
    {
        title: 'Threads',
        rows: [
            {
                id: 'shaping-thread-cleanup',
                title: 'Shaping threads after Start build',
                description: 'Choose what happens when a build starts.',
                help: "What the board does to an item's shaping threads when its build starts. Keep changes nothing. Settle settles them in T3, and Archive archives them there. Item details still links to a settled thread. An archived thread has no link on the board and reopens from T3's Settings, Archived. Delete removes them from T3. Delete can't be undone from the board, and the item's stats no longer count that thread.",
                control: custom(() => <ShapingThreadCleanupSetting state={data.shapingThreadCleanup} />),
            },
        ],
    },
    {
        title: 'Commands',
        rows: [
            {
                id: 'heavy-command-limit',
                title: 'Heavy commands at once',
                description: 'Limit test suites and builds on this Mac.',
                help: 'How many heavy commands, such as test suites and builds, may run at once on this Mac, across all builds and worktrees. Automatic allows one for every 4 CPUs or 8 GB of memory, whichever is fewer, and at least one.',
                control: custom(() => (
                    <LimitSetting
                        name="heavy-command-limit"
                        label="Heavy commands at once"
                        field="Heavy command limit"
                        state={data.heavyCommandLimit}
                    />
                )),
            },
            {
                id: 'build-limit',
                title: 'Builds at once',
                description: 'Limit builds on this Mac.',
                help: 'How many builds may work at once on this Mac, across all Projects. Automatic follows the heavy command limit. Start build and Start after always go ahead, even past this limit.',
                control: custom(() => (
                    <LimitSetting
                        name="build-limit"
                        label="Builds at once"
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
                description: 'Used when Auto-build starts a build.',
                help: 'The model of the build threads Auto-build starts. With T3 Project default, each build uses the default model of its T3 project. Turn Auto-build on in the Ready to build header.',
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
