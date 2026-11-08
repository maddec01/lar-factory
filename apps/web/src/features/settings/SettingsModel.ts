// The shape of Settings' pages, which the board search also reads, and the board data they show.

import type { BoardData, Item, TargetSnapshot } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import type { Control } from '@/shared/settings/SettingControls';

export interface Row {
    id: string;
    title: string;
    /** Search terms retained when a setting gets a clearer name. */
    keywords?: string;
    /** Beside the title, in its line. */
    icon?: ReactNode;
    description?: ReactNode;
    help?: ReactNode;
    control: Control;
    /** Shown under the title and the control, across the row's whole width. */
    below?: ReactNode;
    /** It only says something, with nothing to set or read, so the board search doesn't offer it as a setting. */
    noteOnly?: true;
}
export interface Group {
    title: string;
    help?: ReactNode;
    description?: string;
    rows: Row[];
    action?: ReactNode;
    footer?: ReactNode;
    note?: ReactNode;
}
export interface Page {
    id: string;
    label: string;
    /** Search terms retained when a former group is folded into the subtitle. */
    keywords?: string;
    icon: ReactNode;
    description: string;
    groups: Group[];
}

/** The board data Settings shows. Diagnostics says only whether a read has landed, so a new read's time changes nothing here. */
export type SettingsData = Pick<
    BoardData,
    | 'capture'
    | 'repos'
    | 'onboarding'
    | 'tools'
    | 'toolProgress'
    | 'bundledSkills'
    | 'retention'
    | 'refreshSeconds'
    | 'shapingThreadCleanup'
    | 'heavyCommandLimit'
    | 'buildLimit'
    | 'autoBuild'
    | 'modelChoices'
    | 't3Defaults'
> & { everRead: boolean };

export function settingsData({
    capture,
    repos,
    onboarding,
    tools,
    toolProgress,
    bundledSkills,
    retention,
    refreshSeconds,
    shapingThreadCleanup,
    heavyCommandLimit,
    buildLimit,
    autoBuild,
    modelChoices,
    t3Defaults,
    fetchedAt,
}: BoardData): SettingsData {
    return {
        capture,
        repos,
        onboarding,
        tools,
        toolProgress,
        bundledSkills,
        retention,
        refreshSeconds,
        shapingThreadCleanup,
        heavyCommandLimit,
        buildLimit,
        autoBuild,
        modelChoices,
        t3Defaults,
        everRead: !!fetchedAt,
    };
}

export interface PagesInput {
    data: SettingsData;
    /** Whether the board app's bridge is there. */
    app: boolean;
    /** The bridge's Skill folders, null while they load. */
    targets: TargetSnapshot[] | null;
    /** The running version, once the updater has said. */
    version: string | null;
    /** Archive's work as /api/archive answered last, null before Archive first reads it, and why that read failed. */
    archive: { items: Item[] | null; problem: string | null };
}

export const custom = (render: () => ReactNode): Control => ({ type: 'custom', render });
