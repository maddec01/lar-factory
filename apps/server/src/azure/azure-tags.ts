// A project's work item tags through az, for onboarding's Labels step. Azure DevOps has no label list: a tag exists once
// a work item carries it, and the Tags API lists the project's tags and renames one, which every work item keeps.

import { decodePart } from '@lar-factory/shared';
import { az, orgFlags, withFile, type Az } from './azure-items.ts';

/** The Tags API is a preview one. */
const TAGS_API_VERSION = '7.1-preview.1';

/** `az devops invoke` on the tags of the project of `repo`, organization/project/repository. */
function tags<T>(run: Az, repo: string, route: string[], more: string[] = []): Promise<T> {
  const [organization, project] = repo.split('/') as [string, string];
  return run(['devops', 'invoke', '--area', 'wit', '--resource', 'tags', '--route-parameters', `project=${decodePart(project)}`, ...route, ...more,
    '--api-version', TAGS_API_VERSION, ...orgFlags(organization)])
    .then((text) => JSON.parse(text) as T);
}

/** The names of the tags in the repository's project. */
export async function listTags(repo: string, run: Az = az): Promise<string[]> {
  return (await tags<{ value: { name: string }[] }>(run, repo, [])).value.map((t) => t.name);
}

/** Renames a tag in the repository's project, so each work item that carries it has it under its new name. */
export async function renameTag(repo: string, from: string, to: string, run: Az = az): Promise<void> {
  await withFile({ name: to }, (file) => tags(run, repo, [`tagIdOrName=${from}`], ['--http-method', 'PATCH', '--in-file', file]));
}
