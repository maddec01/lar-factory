// Structure sync carries public relationships, omitting briefs, local IDs and progress. Gated briefs use the separate Spec path.
import type { Kind } from './model.ts';
import { isRecord } from './is-record.ts';

export interface TrackerPart { url: string; title: string; kind: Kind; repository?: string }
export interface TrackerDependency {
  need: string;
  owner: string;
  contract?: string;
  evidence?: string;
  ticket?: string;
  pullRequests?: string[];
  handover?: string;
  blocks: string[];
}
export interface TrackerStructure {
  version: 1;
  kind: Kind;
  identity?: string;
  repository?: string;
  snapshot?: { root: string; repository?: string; generation: string; digest: string; previous?: string | null; chunks: { id: string; digest: string }[] };
  /** Explicitly shared concept map, including its Mermaid source. */
  map?: string;
  parent?: TrackerPart;
  parts?: TrackerPart[];
  blockers?: TrackerPart[];
  connections?: TrackerPart[];
  dependencies?: TrackerDependency[];
}

const KINDS = ['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'issue'];
const START = '<!-- lar-factory:structure';
const BLOCK = /<!-- lar-factory:structure\s*\n([\s\S]*?)\n-->/g;
export const STRUCTURE_LABEL = 'linked-work';
export const MAX_TRACKER_STRUCTURE = 262_144;
const text = (value: unknown, limit = 16_384): value is string => typeof value === 'string' && value.length <= limit;

/** Typed tracker URLs keep an Azure work item distinct from a repository PR. */
export const trackerIssueUrl = (repository: string, number: number): string => repository.split('/').length === 2
  ? `https://github.com/${repository}/issues/${number}` : `https://dev.azure.com/${repository.split('/')[0]}/${repository.split('/')[1]}/_workitems/edit/${number}`;
export const trackerPullRequestUrl = (repository: string, number: number): string => repository.split('/').length === 2
  ? `https://github.com/${repository}/pull/${number}` : `https://dev.azure.com/${repository.split('/')[0]}/${repository.split('/')[1]}/_git/${repository.split('/')[2]}/pullrequest/${number}`;
const safeNumber = (value: string) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function trackerReference(url: unknown): { repository: string; number: number } | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const github = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/issues\/([1-9]\d*)\/?$/i.exec(url);
  if (github && safeNumber(github[2]!)) return { repository: github[1]!, number: Number(github[2]) };
  const azure = /^https:\/\/dev\.azure\.com\/([\w.-]+)\/([\w.%~-]+)\/_workitems\/edit\/([1-9]\d*)\/?$/i.exec(url);
  return azure && safeNumber(azure[3]!) ? { repository: `${azure[1]}/${azure[2]}`, number: Number(azure[3]) } : null;
}
export function trackerPullRequestReference(url: unknown): {repository:string;number:number} | null {
  if(typeof url!=='string' || url.length>2048)return null;
  const github=/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9]\d*)\/?$/i.exec(url);
  if(github && safeNumber(github[2]!))return {repository:github[1]!,number:Number(github[2])};
  const azure=/^https:\/\/dev\.azure\.com\/([\w.-]+)\/([\w.%~-]+)\/_git\/([\w.%~-]+)\/pullrequest\/([1-9]\d*)\/?$/i.exec(url);
  return azure && safeNumber(azure[4]!) ? {repository:`${azure[1]}/${azure[2]}/${azure[3]}`,number:Number(azure[4])}:null;
}
const part = (value: unknown): value is TrackerPart => isRecord(value) && !!trackerReference(value.url)
  && (value.repository === undefined || text(value.repository, 1024) && /^[^\s/#]+(\/[^\s/#]+)+$/.test(value.repository))
  && text(value.title, 1024) && KINDS.includes(String(value.kind)) && Object.keys(value).every(key => ['url', 'title', 'kind', 'repository'].includes(key));
const parts = (value: unknown) => value === undefined || Array.isArray(value) && value.length <= 200 && value.every(part);

/** Strict parsing means an edited or newer block never silently changes local structure. */
export function validateTrackerStructure(value: unknown): TrackerStructure {
  if (!isRecord(value) || value.version !== 1 || !KINDS.includes(String(value.kind))
    || !Object.keys(value).every(key => ['version', 'kind', 'identity', 'repository', 'snapshot', 'map', 'parent', 'parts', 'blockers', 'connections', 'dependencies'].includes(key))
    || value.repository !== undefined && (typeof value.repository !== 'string' || !/^[^\s/#]+(\/[^\s/#]+)+$/.test(value.repository))
    || value.identity !== undefined && (typeof value.identity !== 'string' || !/^[a-f0-9-]{36}$/.test(value.identity))
    || value.snapshot !== undefined && (!isRecord(value.snapshot) || !trackerReference(value.snapshot.root)
      || value.snapshot.previous !== undefined && value.snapshot.previous !== null && !/^[a-f0-9]{64}$/.test(String(value.snapshot.previous))
      || !text(value.snapshot.generation, 128) || !/^[a-f0-9]{64}$/.test(String(value.snapshot.digest))
      || !Array.isArray(value.snapshot.chunks) || value.snapshot.chunks.length > 250
      || !value.snapshot.chunks.every(chunk => isRecord(chunk) && /^[1-9]\d*$/.test(String(chunk.id)) && /^[a-f0-9]{64}$/.test(String(chunk.digest))))
    || value.map !== undefined && !text(value.map, 131_072)
    || value.parent !== undefined && !part(value.parent) || !parts(value.parts) || !parts(value.blockers) || !parts(value.connections)) {
    throw Error('This issue has invalid factory structure.');
  }
  if (value.dependencies !== undefined && (!Array.isArray(value.dependencies) || value.dependencies.length > 100 || !value.dependencies.every(dependency =>
    isRecord(dependency) && Object.keys(dependency).every(key => ['need', 'owner', 'contract', 'evidence', 'ticket', 'pullRequests', 'handover', 'blocks'].includes(key))
    && text(dependency.need) && !!dependency.need.trim() && text(dependency.owner, 1024) && !!dependency.owner.trim()
    && ['contract', 'evidence', 'handover'].every(key => dependency[key] === undefined || text(dependency[key]))
    && (dependency.ticket === undefined || !!trackerReference(dependency.ticket))
    && (dependency.pullRequests === undefined || Array.isArray(dependency.pullRequests) && dependency.pullRequests.length <= 100
      && dependency.pullRequests.every(url => !!trackerPullRequestReference(url)))
    && Array.isArray(dependency.blocks) && dependency.blocks.length <= 200 && dependency.blocks.every(url => !!trackerReference(url))))) throw Error('This issue has invalid factory dependencies.');
  if (JSON.stringify(value).length > MAX_TRACKER_STRUCTURE) throw Error('This issue has too much factory structure.');
  return value as unknown as TrackerStructure;
}

export function readTrackerStructure(body: string): TrackerStructure | undefined {
  if (!body.includes(START)) return undefined;
  const matches = [...body.matchAll(BLOCK)];
  if (matches.length !== 1 || body.split(START).length !== 2 || matches[0]![1]!.length > MAX_TRACKER_STRUCTURE) throw Error('This issue has an invalid factory structure block.');
  let value: unknown;
  try { value = JSON.parse(matches[0]![1]!); } catch { throw Error('This issue has invalid factory structure JSON.'); }
  return validateTrackerStructure(value);
}

/** Replace only the unique managed block, preserving every authored byte outside it. */
export function writeTrackerStructure(body: string, structure: TrackerStructure): string {
  const validated = validateTrackerStructure(structure);
  readTrackerStructure(body);
  const block = `${START}\n${JSON.stringify(validated).replaceAll('<', '\\u003c')}\n-->`;
  return body.includes(START) ? body.replace(BLOCK, () => block) : `${body}${body.endsWith('\n') ? '\n' : '\n\n'}${block}\n`;
}

/** Native issue types and ordinary labels work without factory labels or setup. */
export function trackerKind(labels: readonly string[], nativeType?: string | null): Kind {
  const names = [...labels, nativeType ?? ''].map(name => name.toLowerCase());
  if (names.includes('concept')) return 'concept';
  if (names.some(name => name.startsWith('decision-')) || names.includes('decision')) return 'decision';
  if (names.some(name => ['bug', 'defect'].includes(name))) return 'bug';
  if (names.some(name => ['feature', 'enhancement', 'user story', 'product backlog item'].includes(name))) return 'feature';
  if (names.includes('improvement')) return 'improvement';
  return names.includes('build') ? 'build' : 'issue';
}

/** Keep factory transport bytes out of descriptions, editors and ordinary comment lists. */
export const isStructureComment = (body: string): boolean => body.trimStart().startsWith('<!-- lar-factory:chunk ') || body.trimStart().startsWith('<!-- lar-factory:structure');
export function stripTrackerStructure(body: string): string {
  return body.replace(BLOCK, '').trimEnd();
}
