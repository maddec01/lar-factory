// A repository's place in the board's list, which picks its project icon's colour. An unlisted repository stays muted.

import { sameRepo, type RepoConfig } from '@lar-factory/shared';

/** A repository's place among the board's repositories, which gives it its colour, or undefined for a repository the
 *  board doesn't list (the muted colour). `repo` is a repository key. */
export function repoPlace(repo: string, repos: readonly RepoConfig[]): number | undefined {
    const at = repos.findIndex((r) => sameRepo(r.repo, repo));

    return at < 0 ? undefined : at;
}
