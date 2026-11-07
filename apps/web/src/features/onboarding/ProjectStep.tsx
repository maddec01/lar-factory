// Onboarding's first step: the T3 project to add.

import { isOnboarding, type ProjectChoice } from '@lar-factory/shared';
import { Alert, Badge, Button, buttonKind, Input, InsetPanel, RadioGroup } from '@lar-works/design-system';
import { FolderPlus } from '@lar-works/design-system/icons';

import { Pending } from './Pending';
import { Choice } from './SetupFields';
import { unpickable, useWizardStore, type Run } from './WizardStore';
import { ProjectChoiceIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { FieldRow } from '@/shared/settings/FieldRow';

export function ProjectStep({ run }: { run: Run }) {
    const { projects, creating, pick, chooseNew, loadProjects, setFolder, createProject } = useWizardStore();
    const onboarding = useBoardStore((s) => s.data.onboarding);

    if (projects.state === 'loading') return <Pending>Loading Projects…</Pending>;

    if (projects.state === 'failed')
        return (
            <Alert
                tone="danger"
                title="Could not load Projects"
                action={
                    <Button {...buttonKind('other')} onClick={() => void loadProjects()}>
                        Retry
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
                            <RadioGroup
                                aria-label="T3 project"
                                value={run.projectId ?? (creating ? 'new' : '')}
                                onValueChange={(id) => (id === 'new' ? chooseNew() : pick(id as string))}
                                className="min-w-0 gap-1.5"
                            >
                                {rows
                                    .filter(({ reason }) => !reason)
                                    .map(({ project }) => (
                                        <Choice key={project.id} value={project.id}>
                                            <ProjectLine project={project} badge={project.provider} />
                                        </Choice>
                                    ))}
                                <Choice value="new">
                                    <span className="flex min-w-0 flex-1 items-center gap-2">
                                        <FolderPlus aria-hidden className="size-4 shrink-0" />
                                        <span className="min-w-0 font-medium wrap-anywhere">
                                            Add a repository folder
                                        </span>
                                        <span className="text-base-700 min-w-0 flex-1 truncate text-xs">
                                            Choose a folder already on this machine.
                                        </span>
                                    </span>
                                </Choice>
                            </RadioGroup>
                            {creating && (
                                <div className="grid gap-3 rounded-lg border p-3">
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
                                    <span>
                                        <Button
                                            {...buttonKind('other')}
                                            leftIcon={<FolderPlus />}
                                            disabled={!creating.folder.trim()}
                                            loading={creating.adding}
                                            onClick={() => void createProject()}
                                        >
                                            Add folder
                                        </Button>
                                    </span>
                                    {creating.error && (
                                        <Alert tone="danger" title="Could not add folder">
                                            {creating.error}
                                        </Alert>
                                    )}
                                </div>
                            )}
                        </>
                    }
                />
            </InsetPanel>
            <ProjectSection name="added" title="Already added" count={added.length}>
                {added.map(({ project }) => (
                    <li key={project.id} className="flex min-w-0">
                        <ProjectLine
                            project={project}
                            badge={isOnboarding({ onboarding }, project.repo) ? 'Setup in progress' : 'Added'}
                        />
                    </li>
                ))}
            </ProjectSection>
            <ProjectSection name="blocked" title="Can't be added" count={blocked.length}>
                {blocked.map(({ project, reason }) => (
                    <li key={project.id} className="grid min-w-0 gap-0.5">
                        <ProjectLine project={project} badge={null} />
                        <span className="text-base-700 pl-6 text-xs">{reason}</span>
                    </li>
                ))}
            </ProjectSection>
        </>
    );
}

/** A project on one line: its icon, name and badge, then its path, which gives way first. */
function ProjectLine({ project, badge }: { project: ProjectChoice; badge: string | null }) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            <ProjectChoiceIcon project={project} size="row" />
            <span title={project.name} className="max-w-[30%] shrink-0 truncate font-medium sm:max-w-1/2">
                {project.name}
            </span>
            {badge && (
                <span className="shrink-0 whitespace-nowrap">
                    <Badge>{badge}</Badge>
                </span>
            )}
            <span
                data-project-path
                aria-hidden
                title={project.folder}
                className="text-base-700 min-w-0 flex-1 truncate text-xs"
            >
                {project.shownFolder}
            </span>
            <span className="sr-only">{project.folder}</span>
        </span>
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
            <details data-project-section={name} className="min-w-0 rounded-lg border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">
                    {title} ({count})
                </summary>
                <ul className="m-0 mt-2 grid min-w-0 list-none gap-2 p-0">{children}</ul>
            </details>
        )
    );
}
