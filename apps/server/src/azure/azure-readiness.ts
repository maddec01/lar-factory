import { az, orgFlags, problemOf, type Az } from './azure-items.ts';

interface Policy { evaluationId: string; status: string; configuration: { isBlocking: boolean; isEnabled: boolean } }
interface PrStatus { id: number; state: string; context: { name: string; genre?: string }; iterationId?: number }
interface Reviewer { id: string; vote: number; isRequired?: boolean }
export type AzureReadiness = {
  available: true; observedAt: string; sourceRevision: string; policies: Policy[]; statuses: PrStatus[]; reviewers: Reviewer[]; blockers: string[];
} | { available: false; reason: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const malformed = (): never => { throw new Error('Malformed Azure PR evidence'); };
const list = (value: unknown): unknown[] => object(value) && Array.isArray(value.value) ? value.value : malformed();

/** Revision-bound provider evidence. No factory Status is inferred or written. */
export async function readAzureReadiness(organization: string, project: string, repositoryId: string, pullRequestId: number, run: Az = az): Promise<AzureReadiness> {
  const call = async (area: string, resource: string, query: string[] = []): Promise<unknown> => JSON.parse(await run([
    'devops', 'invoke', '--area', area, '--resource', resource, '--route-parameters', `project=${project}`,
    ...area === 'git' ? [`repositoryId=${repositoryId}`, `pullRequestId=${pullRequestId}`] : [],
    ...query.length ? ['--query-parameters', ...query] : [], '--api-version', area === 'policy' ? '7.1-preview' : '7.1', ...orgFlags(organization),
  ]));
  const head = async () => {
    const pr = await call('git', 'pullRequests');
    if (!object(pr) || !object(pr.lastMergeSourceCommit) || typeof pr.lastMergeSourceCommit.commitId !== 'string' || !pr.lastMergeSourceCommit.commitId || !object(pr.repository) || !object(pr.repository.project) || typeof pr.repository.project.id !== 'string') return malformed();
    return { revision: pr.lastMergeSourceCommit.commitId, projectId: pr.repository.project.id };
  };
  try {
    if (!Number.isSafeInteger(pullRequestId) || pullRequestId <= 0) throw new Error('Invalid pull request id');
    const before = await head();
    const policies: Policy[] = [];
    for (;;) {
      const page = list(await call('policy', 'evaluations', [`artifactId=vstfs:///CodeReview/CodeReviewId/${before.projectId}/${pullRequestId}`, 'includeNotApplicable=true', '$top=100', `$skip=${policies.length}`]));
      for (const p of page) {
        if (!object(p) || typeof p.evaluationId !== 'string' || typeof p.status !== 'string' || !object(p.configuration) || typeof p.configuration.isBlocking !== 'boolean' || typeof p.configuration.isEnabled !== 'boolean') return malformed();
        if (policies.some((old) => old.evaluationId === p.evaluationId)) throw new Error('Azure repeated a policy page');
        policies.push(p as unknown as Policy);
      }
      if (page.length < 100) break;
    }
    const statuses = list(await call('git', 'pullRequestStatuses')).map((s) => {
      if (!object(s) || typeof s.id !== 'number' || (s.state !== undefined && typeof s.state !== 'string') || !object(s.context) || typeof s.context.name !== 'string' || (s.iterationId !== undefined && typeof s.iterationId !== 'number')) return malformed();
      // Azure omits state for unset statuses. Keep them as blockers instead of discarding all evidence.
      return { ...s, state: s.state ?? 'notSet' } as unknown as PrStatus;
    });
    const reviewers = list(await call('git', 'pullRequestReviewers')).map((r) => {
      if (!object(r) || typeof r.id !== 'string' || typeof r.vote !== 'number' || (r.isRequired !== undefined && typeof r.isRequired !== 'boolean')) return malformed();
      return r as unknown as Reviewer;
    });
    const after = await head();
    if (before.revision !== after.revision) return { available: false, reason: 'PR source revision changed while reading evidence' };
    const blockers = policies.filter((p) => p.configuration.isEnabled && p.configuration.isBlocking && !['approved', 'notApplicable'].includes(p.status)).map((p) => `policy:${p.evaluationId}:${p.status}`);
    for (const r of reviewers) if (r.vote < 0 || (r.isRequired && ![5, 10].includes(r.vote)) || ![-10, -5, 0, 5, 10].includes(r.vote)) blockers.push(`reviewer:${r.id}:${r.vote}`);
    for (const s of statuses) if (!['succeeded', 'notApplicable'].includes(s.state)) blockers.push(`status:${s.context.genre ?? ''}/${s.context.name}:${s.state}`);
    return { available: true, observedAt: new Date().toISOString(), sourceRevision: before.revision, policies, statuses, reviewers, blockers };
  } catch (error) { const problem = problemOf(error); return { available: false, reason: problem instanceof Error ? problem.message : String(problem) }; }
}
