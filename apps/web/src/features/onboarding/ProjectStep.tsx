// Onboarding's first step: the T3 project to add.

import { isOnboarding, type ProjectChoice } from '@lar-factory/shared';
import {
    Alert,
    Button,
    Disclosure,
    FormFieldset,
    Inline,
    Input,
    InsetPanel,
    RadioChoice,
} from '@lar-works/design-system';
import { FolderPlus } from '@lar-works/design-system/icons';

import { Pending } from './Pending';
import { unpickable, useWizardStore, type Run } from './WizardStore';
import { ProjectChoiceIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { FieldRow } from '@/shared/settings/FieldRow';
import {
    AddFolderLine,
    buttonKind,
    ChoiceDetails,
    ProjectLine as Line,
    ProjectList,
    ProjectListItem,
} from '@/ui/board';

export function ProjectStep({ run }: { run: Run }) {
    const { projects, creating, pick, chooseNew, loadProjects, setFolder, createProject } = useWizardStore();
    const onboarding = useBoardStore((s) => s.data.onboarding);

    if (projects.state === 'loading') return <Pending>Loading projects…</Pending>;

    if (projects.state === 'sample')
        return (
            <Alert role="status" aria-live="polite" tone="info" title="Sample mode">
                Projects can’t be added in sample mode. You can explore the sample board.
            </Alert>
        );

    if (projects.state === 'failed')
        return (
            <Alert
                tone="danger"
                title="Couldn’t load projects"
                action={
                    <Button {...buttonKind('other')} onClick={() => void loadProjects()}>
                        Try again
                    </Button>
                }
            >
                {projects.error}
            </Alert>
        );

    const rows = projects.projects.map((project) => ({ project, reason: unpickable(project, run, { onboarding }) }));
    const added = rows.filter(({ project, reason }) => reason && project.onBoard);
    const blocked = rows.filter(({ project, reason }) => reason && !project.onBoard);

    return (
        <>
            <InsetPanel presentation="settings">
                <FieldRow
                    label="T3 project"
                    below={
                        <>
                            <FormFieldset presentation="group" legend="T3 project" hiddenLegend>
                                <InsetPanel presentation="settings">
                                    {rows
                                        .filter(({ reason }) => !reason)
                                        .map(({ project }) => (
                                            <RadioChoice
                                                key={project.id}
                                                name="t3-project"
                                                checked={run.projectId === project.id}
                                                onChange={() => pick(project.id)}
                                                data-choice={project.id}
                                            >
                                                <ProjectLine project={project} badge={project.provider} />
                                            </RadioChoice>
                                        ))}
                                    <RadioChoice
                                        name="t3-project"
                                        checked={!run.projectId && !!creating}
                                        onChange={chooseNew}
                                        data-choice="new"
                                    >
                                        <AddFolderLine
                                            title="Add a repository folder"
                                            hint="Choose a folder already on this machine."
                                        />
                                    </RadioChoice>
                                </InsetPanel>
                            </FormFieldset>
                            {creating && (
                                <ChoiceDetails>
                                    <FieldRow label="Repository folder">
                                        <Input
                                            aria-label="Repository folder"
                                            placeholder="~/Developer/my-project"
                                            value={creating.folder}
                                            disabled={creating.adding}
                                            onChange={(event) => setFolder(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' && creating.folder.trim())
                                                    void createProject();
                                            }}
                                        />
                                    </FieldRow>
                                    <Inline as="span">
                                        <Button
                                            {...buttonKind('other')}
                                            leftIcon={<FolderPlus />}
                                            disabled={!creating.folder.trim()}
                                            loading={creating.adding}
                                            onClick={() => void createProject()}
                                        >
                                            Add folder
                                        </Button>
                                    </Inline>
                                    {creating.error && (
                                        <Alert
                                            role={creating.code === 'sample-mode' ? 'status' : 'alert'}
                                            aria-live={creating.code === 'sample-mode' ? 'polite' : 'assertive'}
                                            tone={creating.code === 'sample-mode' ? 'info' : 'danger'}
                                            title={
                                                creating.code === 'sample-mode' ? 'Sample mode' : 'Couldn’t add folder'
                                            }
                                        >
                                            {creating.error}
                                        </Alert>
                                    )}
                                </ChoiceDetails>
                            )}
                        </>
                    }
                />
            </InsetPanel>
            <ProjectSection name="added" title="Already added" count={added.length}>
                {added.map(({ project }) => (
                    <ProjectListItem key={project.id}>
                        <ProjectLine
                            project={project}
                            badge={isOnboarding({ onboarding }, project.repo) ? 'Setup in progress' : 'Added'}
                        />
                    </ProjectListItem>
                ))}
            </ProjectSection>
            <ProjectSection name="blocked" title="Can’t be added" count={blocked.length}>
                {blocked.map(({ project, reason }) => (
                    <ProjectListItem key={project.id} reason={reason!}>
                        <ProjectLine project={project} badge={null} />
                    </ProjectListItem>
                ))}
            </ProjectSection>
        </>
    );
}

/** A project on one line: its icon, name and badge, then its path, which gives way first. */
function ProjectLine({ project, badge }: { project: ProjectChoice; badge: string | null }) {
    return (
        <Line
            icon={<ProjectChoiceIcon project={project} size="md" />}
            name={project.name}
            badge={badge}
            path={project.shownFolder}
            fullPath={project.folder}
        />
    );
}

/** Projects that can't be picked, folded under their count; nothing when there are none. */
function ProjectSection({
    name,
    title,
    count,
    children,
}: {
    name: string;
    title: string;
    count: number;
    children: React.ReactNode;
}) {
    return (
        count > 0 && (
            <Disclosure data-project-section={name} presentation="framed" label={`${title} (${count})`}>
                <ProjectList>{children}</ProjectList>
            </Disclosure>
        )
    );
}
