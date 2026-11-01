// Azure evaluates the signed-in user's permissions. These calls only read metadata.
import { decodePart, type RepositoryOperation } from '@lar-factory/shared';
import { API_VERSION, az, azureGet, orgFlags, type Az } from '../azure/azure-items.ts';

type Access = Partial<Record<RepositoryOperation, 'allowed' | 'refused'>>;
interface Namespace { namespaceId: string; name: string; actions: { name: string; bit: number }[] }

/** Read action names rather than assuming permission bit values across Azure versions. */
export async function azureAccess(repo: string, run: Az = az): Promise<Access> {
  const [organization, projectName, repository] = repo.split('/') as [string, string, string];
  const origin = `https://dev.azure.com/${organization}`;
  const project = decodePart(projectName);
  const shown = JSON.parse(await run(['repos', 'show', '--repository', decodePart(repository), '--project', project, ...orgFlags(organization)])) as { id: string; project: { id: string } };
  const namespaces = await azureGet<{ value: Namespace[] }>(`${origin}/_apis/securitynamespaces?api-version=${API_VERSION}`, run);
  const evaluate = async (namespace: string, token: string, action: string): Promise<'allowed' | 'refused' | undefined> => {
    const space = namespaces.value.find((s) => s.name === namespace);
    const permission = space?.actions.find((a) => a.name === action);
    if (!space || !permission) return undefined;
    try {
      const answer = await azureGet<{ value: boolean[] }>(`${origin}/_apis/permissions/${space.namespaceId}/${permission.bit}?tokens=${encodeURIComponent(token)}&api-version=${API_VERSION}`, run);
      return answer.value.length === 1 && typeof answer.value[0] === 'boolean' ? answer.value[0] ? 'allowed' : 'refused' : undefined;
    } catch { return undefined; }
  };
  const git = `repoV2/${shown.project.id}/${shown.id}`;
  const [contribute, branch, pr, tagging, area] = await Promise.all([
    evaluate('Git Repositories', git, 'GenericContribute'), evaluate('Git Repositories', git, 'CreateBranch'),
    evaluate('Git Repositories', git, 'PullRequestContribute'),
    // Create is the project's "Create tag definition", which a new tag on a work item needs; Update and Delete are rename and delete.
    Promise.all(['Create', 'Update', 'Delete'].map((action) => evaluate('Tagging', `/${shown.project.id}`, action))),
    azureGet<{ identifier: string }>(`${origin}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/areas?api-version=${API_VERSION}`, run).catch(() => null),
  ]);
  const access: Access = {};
  if (contribute === 'refused' || branch === 'refused') access['push-branch'] = 'refused';
  else if (contribute === 'allowed' && branch === 'allowed') access['push-branch'] = 'allowed';
  if (pr) access['open-pr'] = pr;
  if (tagging.includes('refused')) access['manage-labels'] = 'refused';
  else if (tagging.every((answer) => answer === 'allowed')) access['manage-labels'] = 'allowed';
  if (area?.identifier) {
    const edit = await evaluate('CSS', `vstfs:///Classification/Node/${area.identifier}`, 'WORK_ITEM_WRITE');
    if (edit) for (const op of ['publish-ticket', 'edit-ticket', 'comment-ticket', 'type-ticket', 'relate-ticket', 'tag-ticket'] as const) access[op] = edit;
  }
  return access;
}
