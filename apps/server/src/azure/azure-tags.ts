// A project's work item tags through az, for Edit's labels. Azure DevOps has no label list: a tag exists once a work
// item carries it, and the Tags API lists the project's tags.

import { decodePart } from '@lar-factory/shared';
import { az, orgFlags, type Az } from './azure-items.ts';

/** The Tags API's released version: az devops invoke reads `--api-version` as a number, so it can't pass `7.1-preview.1`. */
const TAGS_API_VERSION = '7.1';

/** `az devops invoke` on the tags of the project of `repo`, organization/project/repository. */
function tags<T>(run: Az, repo: string, route: string[]): Promise<T> {
  const [organization, project] = repo.split('/') as [string, string];
  return run(['devops', 'invoke', '--area', 'wit', '--resource', 'tags', '--route-parameters', `project=${decodePart(project)}`, ...route,
    '--api-version', TAGS_API_VERSION, ...orgFlags(organization)])
    .then((text) => JSON.parse(text) as T);
}

/** The names of the tags in the repository's project. */
export async function listTags(repo: string, run: Az = az): Promise<string[]> {
  return (await tags<{ value: { name: string }[] }>(run, repo, [])).value.map((t) => t.name);
}
