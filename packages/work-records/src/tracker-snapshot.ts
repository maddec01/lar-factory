// Validate untrusted tracker bytes before they can choose any authenticated context read or cache write.
import { isRecord, trackerPullRequestReference, trackerReference, trackerIssueUrl } from '@lar-factory/shared';
import { WorkRecordError } from './database.ts';
import type { TrackerSnapshot } from './tracker-cache.ts';

const invalid = (message: string): never => { throw new WorkRecordError('invalid', message); };
const KINDS = ['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'issue'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const repository = (value: unknown): value is string => typeof value === 'string' && /^(?:[\w.-]+\/[\w.-]+|[\w.-]+\/[\w.%~-]+\/[\w.%~-]+)$/.test(value)
  && value.split('/').every(part => part !== '.' && part !== '..');
const only = (value: Record<string, unknown>, names: string[]) => Object.keys(value).every(key => names.includes(key));
const shortText = (value: unknown, maximum = 16_384): value is string => typeof value === 'string' && value.length <= maximum;
const ticketReference = (value: unknown, repo: string): value is string => {
  if (typeof value !== 'string') return false;
  const split = value.lastIndexOf('#');
  return value.slice(0, split).toLowerCase() === repo.toLowerCase() && /^[1-9]\d*$/.test(value.slice(split + 1)) && Number.isSafeInteger(Number(value.slice(split + 1)));
};

export function validateTrackerSnapshot(input: unknown): TrackerSnapshot {
  if (!isRecord(input) || input.version !== 1 || !only(input, ['version', 'root', 'nodes', 'dependencies'])
    || typeof input.root !== 'string' || !UUID.test(input.root) || !Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > 1000
    || !Array.isArray(input.dependencies) || input.dependencies.length > 1000 || JSON.stringify(input).length > 16 * 1024 * 1024) invalid('The saved structure has an unsupported format.');
  for (const node of (input as {nodes:unknown[]}).nodes) {
    if (!isRecord(node) || !only(node, ['key', 'repository', 'kind', 'title', 'ticket', 'parent', 'blockers', 'map'])
      || typeof node.key !== 'string' || !UUID.test(node.key) || !repository(node.repository) || !KINDS.includes(String(node.kind))
      || !shortText(node.title, 1024) || node.ticket !== null && !ticketReference(node.ticket, node.repository)
      || node.parent !== null && (typeof node.parent !== 'string' || !UUID.test(node.parent))
      || !Array.isArray(node.blockers) || node.blockers.length > 1000 || node.blockers.some(key => typeof key !== 'string' || !UUID.test(key))
      || new Set(node.blockers).size !== node.blockers.length || node.map !== undefined && (node.kind !== 'concept' || !shortText(node.map, 1024 * 1024))) invalid('The saved structure has invalid parts or a repository/ticket mismatch.');
  }
  const value = input as unknown as TrackerSnapshot;
  const byId = new Map(value.nodes.map(node => [node.key, node]));
  const tickets = value.nodes.flatMap(node => node.ticket ? [node.ticket.toLowerCase()] : []);
  if (!byId.has(value.root) || byId.size !== value.nodes.length || new Set(tickets).size !== tickets.length) invalid('The saved structure has invalid identities.');
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) invalid('The saved structure has a blocker cycle.');
    if (visited.has(key)) return;
    visiting.add(key);
    for (const blocker of byId.get(key)!.blockers) {
      if (!byId.has(blocker)) invalid('The saved structure has a missing blocker.');
      visit(blocker);
    }
    visiting.delete(key); visited.add(key);
  };
  for (const key of byId.keys()) visit(key);
  for (const node of value.nodes) {
    const seen = new Set<string>();
    for (let next = node; next.parent !== null;) {
      if (seen.has(next.key)) invalid('The saved structure has a parent cycle.');
      seen.add(next.key);
      const parent = byId.get(next.parent);
      if (!parent || parent.kind !== 'concept' || !['decision', 'build'].includes(next.kind)) invalid('The saved structure has invalid ownership.');
      next = parent!;
    }
  }
  const dependencyIds = new Set<string>();
  for (const dependency of value.dependencies) {
    if (!isRecord(dependency) || !only(dependency, ['key', 'work', 'need', 'owner', 'contract', 'evidence', 'ticket', 'pullRequests', 'handover', 'blocks'])
      || typeof dependency.key !== 'string' || !UUID.test(dependency.key) || dependencyIds.has(dependency.key) || !byId.has(dependency.work)
      || !shortText(dependency.need) || !dependency.need.trim() || !shortText(dependency.owner, 1024) || !dependency.owner.trim()
      || ['contract', 'evidence', 'handover'].some(key => dependency[key as 'contract'] !== undefined && !shortText(dependency[key as 'contract']))
      || !Array.isArray(dependency.blocks) || dependency.blocks.length > 1000 || dependency.blocks.some(key => !byId.has(key) || byId.get(key)!.kind !== 'build')
      || new Set(dependency.blocks).size !== dependency.blocks.length
      || dependency.pullRequests !== undefined && (!Array.isArray(dependency.pullRequests) || dependency.pullRequests.length > 100 || dependency.pullRequests.some(url => !trackerPullRequestReference(url)))) invalid('The saved structure has invalid dependencies.');
    dependencyIds.add(dependency.key);
    if (dependency.ticket !== undefined) {
      if (!trackerReference(dependency.ticket) || !value.nodes.some(node => node.ticket && trackerIssueUrl(node.repository, Number(node.ticket.slice(node.ticket.lastIndexOf('#') + 1))) === dependency.ticket)) invalid('The saved structure has a missing dependency-ticket member.');
    }
  }
  return value;
}
