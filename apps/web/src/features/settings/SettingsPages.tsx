// Settings shows working controls and real read-only values. Unbuilt controls show their availability inline.

import { Archive, FolderGit2, Plug, RefreshCw, Settings2, Sparkles, Stethoscope } from '@lar-works/design-system/icons';

import { ChannelChoice, UpdateAction, UpdateStatus, UpdatesNote } from './AppRows';
import { archiveGroups } from './ArchiveRows';
import { generalGroups } from './GeneralSettings';
import { repositoryGroup } from './ProjectRows';
import { custom, type Page, type PagesInput, type Row } from './SettingsModel';
import { bundledGroup, targetGroup } from './SkillRows';
import { DIAGNOSED, azSkipped, ghSkipped, stateOf, toolDescription } from './ToolRows';
import { ToolState } from '@/shared/ui/setting-rows/SettingControls';

export { settingsData } from './SettingsModel';
export type { Group, Page, PagesInput, SettingsData } from './SettingsModel';

const ONLY_APP_UPDATES = 'Only the board app updates itself.';

function updateRows({ app, version }: PagesInput): Row[] {
    const channel = {
        id: 'channel',
        title: 'Update channel',
        description: 'Nightly offers each Nightly Release; Latest only Stable Releases.',
    };

    if (!app) return [{ id: 'updates-app-only', title: ONLY_APP_UPDATES, noteOnly: true, control: custom(() => null) }];

    return [
        { ...channel, control: custom(() => <ChannelChoice />) },
        {
            id: 'version',
            title: version ? `Lar Factory ${version}` : 'Lar Factory',
            description: <UpdateStatus />,
            control: custom(() => <UpdateAction />),
        },
    ];
}

export function pages(input: PagesInput): Page[] {
    const { data } = input;

    return [
        {
            id: 'general',
            label: 'General',
            icon: <Settings2 />,
            description: '',
            groups: generalGroups(data),
        },
        { id: 'projects', label: 'Projects', icon: <FolderGit2 />, description: '', groups: [repositoryGroup(data)] },
        {
            id: 'integrations',
            label: 'Integrations',
            icon: <Plug />,
            description: 'Uses your own command line login. Lar Factory never stores a token.',
            groups: [
                {
                    title: 'Issue trackers',
                    rows: [
                        {
                            id: 'gh',
                            title: 'GitHub',
                            description: toolDescription('Uses your GitHub CLI login.', data.tools?.gh),
                            control: custom(() => <ToolState {...stateOf(data, 'gh', true)} />),
                        },
                        {
                            id: 'az',
                            title: 'Azure DevOps',
                            description: toolDescription(
                                `Uses your Azure CLI login and Azure DevOps extension.${azSkipped(data)}`,
                                data.tools?.az,
                            ),
                            control: custom(() => <ToolState {...stateOf(data, 'az', true)} />),
                        },
                    ],
                },
            ],
        },
        {
            id: 'skills',
            label: 'Skills',
            icon: <Sparkles />,
            description: '',
            groups: [targetGroup(input), bundledGroup(input)],
        },
        {
            id: 'updates',
            label: 'Updates',
            icon: <RefreshCw />,
            description: '',
            groups: [{ title: '', rows: updateRows(input), ...(input.app && { note: <UpdatesNote /> }) }],
        },
        {
            id: 'archive',
            label: 'Archive',
            icon: <Archive />,
            description:
                'Work off the board: set aside, or finished and hidden. This Mac keeps it until a timed delete runs.',
            groups: archiveGroups(data, input.archive),
        },
        {
            id: 'diagnostics',
            label: 'Diagnostics',
            icon: <Stethoscope />,
            description: '',
            groups: [
                {
                    title: 'Tools',
                    rows: [
                        ...DIAGNOSED.filter(([name]) => name !== 'gh' || !ghSkipped(data)).map(([name, does]): Row => ({
                            id: `d-${name}`,
                            title: name,
                            description: toolDescription(does, data.tools?.[name]),
                            control: custom(() => <ToolState {...stateOf(data, name)} />),
                        })),
                        {
                            id: 'd-az',
                            title: 'az',
                            description: toolDescription(
                                `Reads repositories on Azure DevOps.${azSkipped(data)}`,
                                data.tools?.az,
                            ),
                            control: custom(() => <ToolState {...stateOf(data, 'az')} />),
                        },
                        {
                            id: 'd-server',
                            title: 'Board server',
                            description: `${location.origin} · last read ${data.everRead ? 'OK' : 'never'}`,
                            control: custom(() => null),
                        },
                    ],
                },
            ],
        },
    ];
}
