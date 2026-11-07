// A project's icon from what the board knows of it: the design system's ProjectIcon, given the project's T3 icon (a
// favicon served by the board), its name and its place among the board's repositories, which picks its colour.

import {
    repoName,
    repositoryProjectIcon,
    sameRepo,
    type ProjectChoice,
    type ProjectIcon as Icon,
    type RepoConfig,
} from '@lar-factory/shared';
import { ProjectIcon as ProjectSquare, type ProjectIconSize, type ProjectIconSource } from '@lar-works/design-system';
import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useBoardStore } from '@/services/board/board.hooks';

/** A repository's place among the board's repositories, which gives it its colour, or undefined for a repository the
 *  board doesn't list (the muted colour). `repo` is a repository key. */
export function repoPlace(repo: string, repos: readonly RepoConfig[]): number | undefined {
    const at = repos.findIndex((r) => sameRepo(r.repo, repo));

    return at < 0 ? undefined : at;
}

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
