import { writeAccessProblem, shownRepo } from '@lar-factory/shared';
// Settings shows working controls and real read-only values. Unbuilt controls show their availability inline.
import { Button, EmptyState } from '@lar-works/design-system';
import { Archive, FolderGit2, Plug, Sparkles } from '@lar-works/design-system/icons';

import { ChannelChoice, UpdateAction, UpdateStatus, UpdatesNote } from './AppRows';
import { archiveGroups } from './ArchiveRows';
import { FactorySettingsSection } from './FactorySettings';
import { generalGroups } from './GeneralSettings';
import { repositoryGroup } from './ProjectRows';
import { RunChecks } from './RunChecks';
import { custom, type Page, type PagesInput, type Row } from './SettingsModel';
import { bundledGroup, targetGroup } from './SkillRows';
import { DIAGNOSED, azSkipped, ghSkipped, stateOf, toolDescription } from './ToolRows';
import { useEditStore } from '@/features/repositories';
import { sampleCapability } from '@/shared/capabilities/sampleCapability';
import { ToolState } from '@/shared/settings/SettingControls';
import { conceptIcons } from '@/ui/board';

export { settingsData } from './SettingsModel';
export type { Group, Page, PagesInput, SettingsData } from './SettingsModel';

function updateRows({ app, version }: PagesInput): Row[] {
    const channel = {
        id: 'channel',
        title: 'Update channel',
        description: 'Nightly includes preview releases; Latest includes stable releases.',
    };

    if (!app) return [];

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
            icon: <conceptIcons.settings />,
            description: 'Manage the appearance, dialogs, threads, command limits and Auto-build on this Mac.',
            groups: generalGroups(data),
        },
        {
            id: 'factory',
            label: 'Reviewers and models',
            keywords:
                'instructions trigger effort planner implementer approver CI fixer Doubt shaping concept decision build',
            icon: <conceptIcons.settings />,
            description:
                'Reviewers, models and effort for future runs on this Mac. Save changes to apply your choices.',
            groups: [
                {
                    title: '',
                    panel: false,
                    rows: [
                        {
                            id: 'factory-settings',
                            title: 'Reviewers, models and effort',
                            control: { type: 'row', render: () => <FactorySettingsSection /> },
                        },
                    ],
                },
            ],
        },
        {
            id: 'projects',
            label: 'Projects',
            icon: <FolderGit2 />,
            description: 'Manage projects and their local settings.',
            groups: [repositoryGroup(data)],
        },
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
                {
                    title: 'Project access',
                    rows: data.repos.map((repo) => {
                        const unavailable = sampleCapability(data, 'access');
                        const problem =
                            unavailable ??
                            writeAccessProblem(repo.repo, 'edit-ticket', repo.setup?.access ?? {}, {
                                azureReadOnly: repo.setup?.azureReadOnly,
                                recheckAction: true,
                            });

                        return {
                            id: `access-${repo.repo}`,
                            title: shownRepo(repo.repo),
                            description: problem ?? 'Ticket metadata can be edited.',
                            control: custom(() => (
                                <Button
                                    variant="secondary"
                                    disabled={!!unavailable}
                                    title={unavailable ?? undefined}
                                    aria-description={unavailable ?? undefined}
                                    onClick={() => void useEditStore.getState().recheck(repo.repo)}
                                >
                                    Recheck access
                                </Button>
                            )),
                        };
                    }),
                },
            ],
        },
        {
            id: 'skills',
            label: 'Skills',
            keywords: 'Skill folders',
            icon: <Sparkles />,
            description: input.app
                ? 'Choose the folders where Lar Factory installs and maintains its skills: copies, or links in a Claude home.'
                : 'Use the Lar Factory app to install and maintain skill folders for your agents.',
            groups: [...(input.app ? [targetGroup(input)] : []), bundledGroup(input)],
        },
        {
            id: 'updates',
            label: 'Updates',
            icon: <conceptIcons.updates />,
            description: 'Choose your release channel and check for app updates.',
            // In a browser there is nothing to set here: the inline empty state says where updates are, rather than a
            // lone sentence in an empty pane.
            groups: input.app
                ? [{ title: '', rows: updateRows(input), note: <UpdatesNote /> }]
                : [
                      {
                          title: '',
                          rows: [
                              {
                                  id: 'updates-in-app',
                                  title: 'Updates',
                                  control: {
                                      type: 'row',
                                      render: () => (
                                          <EmptyState
                                              size="compact"
                                              icon={<conceptIcons.updates />}
                                              title="Updates are in the Mac app"
                                              description="Open Lar Factory on your Mac to check for updates."
                                          />
                                      ),
                                  },
                              },
                          ],
                      },
                  ],
        },
        {
            id: 'archive',
            label: 'Archive',
            icon: <Archive />,
            description:
                'Work off the board: set aside, or finished and hidden. This Mac keeps it unless you delete it or turn on automatic deletion in Archive.',
            groups: archiveGroups(data, input.archive),
        },
        {
            id: 'diagnostics',
            label: 'Diagnostics',
            icon: <conceptIcons.diagnostics />,
            description: 'Check the tools and connections Lar Factory uses.',
            groups: [
                {
                    title: 'Tools',
                    description: sampleCapability(data, 'tools') ?? 'Check the commands Lar Factory uses.',
                    action: <RunChecks />,
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
                            id: 'd-t3-connection',
                            title: 'T3 project connection',
                            description:
                                data.t3Availability?.availability === 'available'
                                    ? 'Projects are available. Run checks opens a fresh connection.'
                                    : data.t3Availability?.availability === 'renewal-required'
                                      ? 'T3 authorization needs renewal. Open T3 Code and run checks again.'
                                      : data.t3Availability?.availability === 'malformed'
                                        ? 'T3 Code returned an unreadable project observation.'
                                        : 'Cannot read T3 projects. The board retries automatically while T3 Code is running.',
                            control: custom(() => (
                                <ToolState
                                    text={
                                        data.t3Availability?.availability === 'available' ? 'Connected' : 'Unavailable'
                                    }
                                    state={data.t3Availability?.availability === 'available' ? 'ready' : 'failed'}
                                />
                            )),
                        },
                        {
                            id: 'd-server',
                            title: 'Board server',
                            description: `${location.origin} · last read ${data.everRead ? 'OK' : 'never'}`,
                            control: custom(() => (
                                <ToolState
                                    text={data.everRead ? 'Connected' : 'Waiting for first read'}
                                    state={data.everRead ? 'ready' : 'waiting'}
                                />
                            )),
                        },
                    ],
                },
            ],
        },
    ];
}
