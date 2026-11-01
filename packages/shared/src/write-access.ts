import { decodePart, onAzure, type OperationAccess, type RepositoryOperation } from './model.ts';

/** Returns the reason a write is denied, or null after verified access and safety checks pass. */
export function writeAccessProblem(repo: string, operation: RepositoryOperation,
  access: Partial<Record<RepositoryOperation, OperationAccess>>,
  options: { azureReadOnly?: boolean; fineGrainedToken?: boolean } = {}): string | null {
  if (onAzure(repo)) {
    const [organization, project] = repo.split('/').map(decodePart);
    if (organization?.toLowerCase() === 'vaneckeurope' && project?.toLowerCase() === 'vaneckdirect iapp') return 'This Azure project must never be written to.';
    if (options.azureReadOnly ?? (typeof process !== 'undefined' && process.env.LAR_FACTORY_AZURE_READ_ONLY === '1')) return 'Azure DevOps is read-only in this test session.';
  }
  if (access[operation] === 'refused') return `Access to ${operation} was refused. Recheck access in Settings.`;
  if (access[operation] === 'allowed') return null;
  if (!onAzure(repo) && options.fineGrainedToken) return 'Fine-grained GitHub token permissions cannot be verified. Sign in with a classic token or gh OAuth login and recheck access.';
  if (!onAzure(repo) && operation === 'edit-ticket' && access['push-branch'] !== 'allowed') return "This login cannot edit other people's issues without verified push access. Recheck access in Settings.";
  return `Access to ${operation} is not checked yet. ${!onAzure(repo) ? 'GitHub permissions require a classic token or gh OAuth login to verify. ' : ''}Recheck access in Settings.`;
}
