import { repoName, repositoryProjectIcon, type ProjectIcon as Icon, type ProjectChoice } from '@lar-factory/shared';
// A project's icon from what the board knows of it: the design system's ProjectIcon, given the project's T3 icon (a
// favicon served by the board), its name and its place among the board's repositories, which picks its colour.
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { repoPlace } from './RepositoryPlace';
import { useBoardStore } from '@/services/board/board.hooks';
import { ProjectIcon as ProjectSquare, type ProjectIconSize, type ProjectIconSource } from '@/ui/board';

/** A T3 icon as the square shows it: a favicon is the board's image of it, by project and content revision. */
const source = (icon: Icon | null | undefined): ProjectIconSource | null =>
    icon?.kind === 'favicon'
        ? {
              kind: 'favicon',
              src: `/api/project-icon/${encodeURIComponent(icon.projectId)}?v=${encodeURIComponent(icon.revision)}`,
          }
        : (icon ?? null);

/** The icon of a repository the board knows. */
export const ProjectIcon = memo(function ProjectIcon({ repo, size }: { repo: string; size: ProjectIconSize }) {
    // A push makes new repos and icons, so this selects what they say here, not those objects.
    const name = useBoardStore((state) => repoName(repo, state.data.repos));
    const place = useBoardStore((state) => repoPlace(repo, state.data.repos));
    const icon = useBoardStore(useShallow((state) => repositoryProjectIcon(state.data, repo)));

    return <ProjectSquare icon={source(icon)} name={name} place={place} size={size} />;
});

/** The icon of a T3 project, which the board may not know: most of onboarding's projects aren't on it. */
export function ProjectChoiceIcon({ project, size }: { project: ProjectChoice; size: ProjectIconSize }) {
    const place = useBoardStore((state) => (project.repo ? repoPlace(project.repo, state.data.repos) : undefined));

    return <ProjectSquare icon={source(project.icon)} name={project.name} place={place} size={size} />;
}
