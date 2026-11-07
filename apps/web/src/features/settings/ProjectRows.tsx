// Settings' Projects page: each Project with its provider and work source.

import { itemSource, shownRepo, type OnboardingProgress } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';

import { custom, type Group, type Row, type SettingsData } from './SettingsModel';
import { useSettingsStore } from './SettingsStore';
import { stoppedAt, useWizardStore } from '@/features/onboarding';
import { ProjectIcon } from '@/features/repositories';
import { kind } from '@/shared/ui/buttons/ButtonKinds';

const ITEM_SOURCES = { issues: 'Issues', 'azure-board': 'Backlog and current sprint' } as const;
const sourceName = (kind: keyof typeof ITEM_SOURCES, team?: string) =>
    kind === 'azure-board' && team ? `${team}'s backlog and current sprint` : ITEM_SOURCES[kind];

/** A repository still onboarding: its provider and the step it stopped at. */
function onboardingDescription(progress: OnboardingProgress): string {
    return [progress.answers.provider, `Onboarding, ${stoppedAt(progress)}`].filter(Boolean).join(' · ');
}

/** Projects with their provider and work source. Read setups open a page, onboarding offers Resume. */
export function repositoryGroup(data: SettingsData): Group {
    const onboarded: Row[] = data.repos.map((r) => ({
        id: `repo-${r.repo}`,
        title: shownRepo(r.repo),
        icon: <ProjectIcon repo={r.repo} size="small" />,
        description: (
            <>
                {itemSource(r) === 'azure-board' ? 'Azure DevOps' : 'GitHub'} · {sourceName(itemSource(r), r.team)}
            </>
        ),
        control: custom(() =>
            r.setup ? (
                <Button {...kind('other')} onClick={() => useSettingsStore.getState().openProject(r.repo)}>
                    Open Project
                </Button>
            ) : null,
        ),
    }));
    const onboarding: Row[] = (data.onboarding ?? []).map(({ repo, progress }) => ({
        id: `repo-${repo}`,
        title: shownRepo(repo),
        icon: <ProjectIcon repo={repo} size="small" />,
        description: onboardingDescription(progress),
        control: custom(() => (
            <Button {...kind('other')} onClick={() => useWizardStore.getState().resume(repo)}>
                Resume
            </Button>
        )),
    }));

    return {
        title: 'Projects',
        description: 'Settings stay on this machine. Projects need no factory files.',
        rows: [...onboarded, ...onboarding],
        footer: (
            <Button {...kind('other')} onClick={() => useWizardStore.getState().start()}>
                Add Project
            </Button>
        ),
    };
}
