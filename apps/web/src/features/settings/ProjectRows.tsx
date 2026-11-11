// Settings' Projects page: each Project with its provider and work source.

import { itemSource, shownRepo, type OnboardingProgress } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';

import { custom, type Group, type Row, type SettingsData } from './SettingsModel';
import { useSettingsStore } from './SettingsStore';
import { stoppedAt, useWizardStore } from '@/features/onboarding';
import { ProjectIcon } from '@/features/repositories';
import { buttonKind } from '@/ui/board';

const ITEM_SOURCES = { issues: 'Issues', 'azure-board': 'Backlog and current sprint' } as const;
const sourceName = (kind: keyof typeof ITEM_SOURCES, team?: string) =>
    kind === 'azure-board' && team ? `${team}’s backlog and current sprint` : ITEM_SOURCES[kind];

/** A repository still onboarding: its provider and the step it stopped at. */
function onboardingDescription(progress: OnboardingProgress): string {
    return [progress.answers.provider, `Onboarding, ${stoppedAt(progress)}`].filter(Boolean).join(' · ');
}

/** Projects with their provider and work source. Read setups open a page, onboarding offers Resume; Resume and Add
 *  project open the setup as a pane in place of this section. */
export function repositoryGroup(data: SettingsData): Group {
    const onboarded: Row[] = data.repos.map((r) => ({
        id: `repo-${r.repo}`,
        title: shownRepo(r.repo),
        icon: <ProjectIcon repo={r.repo} size="sm" />,
        description: (
            <>
                {itemSource(r) === 'azure-board' ? 'Azure DevOps' : 'GitHub'} · {sourceName(itemSource(r), r.team)}
            </>
        ),
        control: custom(() =>
            r.setup ? (
                <Button
                    {...buttonKind('other', { size: 'md' })}
                    onClick={() => useSettingsStore.getState().openProject(r.repo)}
                >
                    Open project
                </Button>
            ) : null,
        ),
    }));
    const onboarding: Row[] = (data.onboarding ?? []).map(({ repo, progress }) => ({
        id: `repo-${repo}`,
        title: shownRepo(repo),
        icon: <ProjectIcon repo={repo} size="sm" />,
        description: onboardingDescription(progress),
        control: custom(() => (
            <Button
                {...buttonKind('other', { size: 'md' })}
                onClick={() => useWizardStore.getState().resume(repo, 'settings')}
            >
                Resume
            </Button>
        )),
    }));

    return {
        // Keep the project group title when search opens this section directly.
        title: 'Projects',
        description: 'Settings stay on this machine. Projects need no factory files.',
        rows: [...onboarded, ...onboarding],
        action: (
            <Button {...buttonKind('other')} onClick={() => useWizardStore.getState().start('settings')}>
                Add project
            </Button>
        ),
    };
}
