// One durable structural writer. A manifest commits only after every immutable chunk is readable.
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapConcurrent, STRUCTURE_LABEL, structureSyncOperations, trackerKind, readTrackerStructure, stripTrackerStructure, sameRepo, trackerReference, writeTrackerStructure, type Kind, type RepositorySetup, type TrackerPart, type TrackerStructure } from '@lar-factory/shared';
import { providerCommand } from '@lar-factory/shared/provider-command';
import { readRepositorySetups } from '@lar-factory/shared/repository-settings';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import type { WorkRecords } from './work-records.ts';
import { validateTrackerSnapshot } from './tracker-snapshot.ts';
import { acquireTrackerSyncLock, TrackerSyncLockLost, type TrackerSyncLease } from './tracker-lock.ts';
import { hasTrackerStructure, trackerDigest, type TrackerSnapshot, type StructureNode } from './tracker-cache.ts';

export interface StructureTicket { repository: string; number: number; body: string; version: string; title?: string; kind?:Kind }
export interface StructureProvider {
  read(repository: string, number: number): Promise<StructureTicket>;
  find(repository: string, identity: string): Promise<StructureTicket[]>;
  create(repository: string, title: string, body: string, type?: string, areaPath?: string): Promise<StructureTicket>;
  creationTarget?(repository: string, team: string): Promise<{type:string;areaPath:string}>;
  comment(ticket: StructureTicket, body: string): Promise<string>;
  readComment(ticket: StructureTicket, id: string): Promise<string>;
  replace(ticket: StructureTicket, body: string): Promise<void>;
}
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (error: unknown) => error instanceof Error ? error.message : String(error);
const numberOf = (reference: string) => Number(reference.slice(reference.lastIndexOf('#') + 1));
export const structureIssueUrl = (repository: string, number: number) => repository.split('/').length === 2
  ? `https://github.com/${repository}/issues/${number}` : `https://dev.azure.com/${repository.split('/')[0]}/${repository.split('/')[1]}/_workitems/edit/${number}`;
const repoFromUrl = (url: string, setups: readonly RepositorySetup[], hint?: string) => {
  const reference = trackerReference(url);
  if (!reference) throw Error('The saved structure links to an unsupported issue URL.');
  if (url.includes('github.com')) return { ...reference };
  const repository = hint ?? setups.find(setup => setup.repo.toLowerCase().startsWith(`${reference.repository.toLowerCase()}/`))?.repo;
  if (!repository || !repository.toLowerCase().startsWith(`${reference.repository.toLowerCase()}/`)) throw Error('Add the Azure repository before loading its saved structure.');
  return { repository, number: reference.number };
};

const githubCommentPages = new Map<string,{etag?:string;comments:{body:string}[]}>();

/** Local CLI login transport, with Azure safety enforced in providerCommand before execution. */
export function structureProvider(): StructureProvider {
  const github = async (path: string, method = 'GET', body?: unknown) => JSON.parse(await providerCommand('gh', ['api', path, '--method', method,
    ...(body === undefined ? [] : ['--input', '-'])], body === undefined ? undefined : JSON.stringify(body))) as Record<string, unknown>;
  const pageCache = githubCommentPages;
  const commentPage = async (path:string):Promise<{body:string}[]> => {
    const cacheKey=`${process.env.GH_PATH ?? 'gh'}:${path}`;
    const cached=pageCache.get(cacheKey);
    let raw:string;
    try {raw=await providerCommand('gh',['api','-i',path,'--method','GET',...(cached?.etag ? ['-H',`If-None-Match: ${cached.etag}`]:[])]);}
    catch(error){if(cached&&/\b304\b/.test(fail(error)))return cached.comments;throw error;}
    const split=/\r?\n\r?\n/.exec(raw);const headers=split ? raw.slice(0,split.index):'';
    const comments=JSON.parse(split ? raw.slice(split.index+split[0].length):raw) as {body:string}[];
    pageCache.set(cacheKey,{etag:/^etag:\s*(.+?)\s*$/im.exec(headers)?.[1],comments});return comments;
  };
  const latestMetadata = async (repository:string,number:number,count:number,original:string) => {
    const ownUrl=structureIssueUrl(repository,number);
    const managed:TrackerStructure[]=[];
    for(let page=Math.max(1,Math.ceil(count/100));page>=1;page--){
      const comments=await commentPage(`repos/${repository}/issues/${number}/comments?per_page=100&page=${page}`);
      for(const comment of [...comments].reverse()){
        if(!comment.body.trimStart().startsWith('<!-- lar-factory:structure'))continue;
        const metadata=readTrackerStructure(comment.body);if(!metadata)continue;managed.push(metadata);
        const latest=managed[0]!;
        if(managed.length>1){
          const before=metadata.snapshot;const after=latest.snapshot;
          if(after&&after.root===ownUrl&&before&&before.root===ownUrl&&after.digest!==before.digest&&after.previous!==before.digest)throw Error('This concept has concurrent tracker versions. Both versions were kept; resolve the structural conflict before continuing.');
          return latest;
        }
        if(!latest.snapshot || latest.snapshot.root!==ownUrl)return latest;
      }
    }
    const latest=managed[0];const before=readTrackerStructure(original)?.snapshot;
    if(latest?.snapshot&&latest.snapshot.root===ownUrl&&before&&before.root===ownUrl&&latest.snapshot.digest!==before.digest&&latest.snapshot.previous!==before.digest)throw Error('This concept has concurrent tracker versions. Both versions were kept.');
    return latest;
  };
  const labelRepos = new Set<string>();
  const markStructural = async (repository:string,number:number) => {
    if(!labelRepos.has(repository)){
      try{await github(`repos/${repository}/labels/${STRUCTURE_LABEL}`);}catch(error){if(!/404/.test(fail(error)))throw error;try{await github(`repos/${repository}/labels`,'POST',{name:STRUCTURE_LABEL,color:'6F42C1',description:'Concept and cross-repository relationships'});}catch(createError){if(!/422/.test(fail(createError)))throw createError;}}
      labelRepos.add(repository);
    }
    await github(`repos/${repository}/issues/${number}/labels`,'POST',{labels:[STRUCTURE_LABEL]});
  };
  const azure = async (repository: string, resource: string, route: string[] = [], body?: unknown, method = body === undefined ? 'GET' : 'POST') => {
    const [org, project] = repository.split('/');
    let folder: string | undefined;
    try {
      const flags = ['devops', 'invoke', '--area', 'wit', '--resource', resource, '--organization', `https://dev.azure.com/${org}`,
        '--route-parameters', `project=${decodeURIComponent(project!)}`, ...route, '--http-method', method, '--api-version', resource === 'comments' ? '7.1-preview.4' : '7.1', '--output', 'json'];
      if (resource === 'comments' && method === 'POST') flags.push('--query-parameters','format=markdown');
      if (body !== undefined) {
        folder = await mkdtemp(join(tmpdir(), 'factory-structure-'));
        const file = join(folder, 'body.json'); await writeFile(file, JSON.stringify(body), { mode: 0o600 });
        flags.push('--in-file', file);
        if (resource === 'workitems') flags.push('--media-type', 'application/json-patch+json');
      }
      return JSON.parse(await providerCommand('az', flags)) as Record<string, unknown>;
    } finally { if (folder) await rm(folder, { recursive: true, force: true }); }
  };
  const asTicket = (repository: string, raw: Record<string, unknown>): StructureTicket => {
    const azure = repository.split('/').length !== 2;
    return { repository, number: Number(raw[azure ? 'id' : 'number']), body: azure ? String((raw.fields as Record<string, unknown>)['System.Description'] ?? '') : String(raw.body ?? ''),
      title:azure ? String((raw.fields as Record<string,unknown>)['System.Title'] ?? '') : String(raw.title ?? ''),
      kind:azure ? trackerKind([],String((raw.fields as Record<string,unknown>)['System.WorkItemType'] ?? '')) : trackerKind((raw.labels as {name:string}[] ?? []).map(label=>label.name),String((raw.type as {name?:string}|undefined)?.name ?? '')),
      version: String(raw[azure ? 'rev' : 'updated_at']) };
  };
  const read = async (repository: string, number: number) => {
    if (repository.split('/').length === 2){
      const raw=await github(`repos/${repository}/issues/${number}`);const ticket=asTicket(repository,raw);
      if((raw.labels as {name:string}[] | undefined)?.some(label=>label.name===STRUCTURE_LABEL)){
        const metadata=await latestMetadata(repository,number,Number(raw.comments ?? 0),ticket.body);
        if(metadata){ticket.body=writeTrackerStructure(ticket.body,metadata);ticket.kind=metadata.kind;}
      }
      return ticket;
    }
    // invoke's workitems discovery route selects {type}, so numeric reads use the unambiguous batch resource.
    const batch=await azure(repository,'workitemsbatch',[],{ids:[number],$expand:'None',errorPolicy:'Fail'});
    const raw=(batch.value as Record<string,unknown>[])[0];
    if(!raw) throw Error('Azure did not return the saved work item.');
    return asTicket(repository,raw);
  };
  return {
    read,
    find: async (repository, identity) => {
      if (repository.split('/').length === 2) {
        const pages = JSON.parse(await providerCommand('gh', ['api', `repos/${repository}/issues?state=all&per_page=100`, '--paginate', '--slurp'])) as Record<string, unknown>[][];
        return pages.flat().filter(raw => !raw.pull_request && String(raw.body ?? '').includes(`"identity":"${identity}"`)).map(raw => asTicket(repository, raw));
      }
      // A lost Azure create never triggers another create automatically. Query recent descriptions by durable identity.
      const project = decodeURIComponent(repository.split('/')[1]!);
      const raw = await azure(repository, 'wiql', [], { query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${project.replaceAll("'", "''")}' AND [System.Description] CONTAINS '${identity}'` });
      return mapConcurrent(raw.workItems as {id:number}[] ?? [],item=>read(repository,item.id));
    },
    creationTarget: async (repository,team) => {
      const [org,project] = repository.split('/');
      const invoke=async(resource:string)=>JSON.parse(await providerCommand('az',['devops','invoke','--area','work','--resource',resource,'--organization',`https://dev.azure.com/${org}`,'--route-parameters',`project=${decodeURIComponent(project!)}`,`team=${team}`,'--http-method','GET','--api-version','7.1','--output','json']));
      const [backlog,fields]=await Promise.all([invoke('backlogconfiguration'),invoke('teamfieldvalues')]);
      const type=backlog.requirementBacklog?.workItemTypes?.[0]?.name;
      if(typeof type!=='string' || typeof fields.defaultValue!=='string') throw Error('The Azure team has no readable issue type or default area. Check its list source.');
      return {type,areaPath:fields.defaultValue};
    },
    create: async (repository, title, body, type, areaPath) => {
      if (repository.split('/').length !== 2 && !type) throw Error('The Azure team has no verified issue type for concept parts.');
      const raw = repository.split('/').length === 2 ? await github(`repos/${repository}/issues`, 'POST', { title, body })
        : await azure(repository, 'workitems', [`type=${type}`], [
          { op: 'add', path: '/fields/System.Title', value: title }, { op: 'add', path: '/fields/System.Description', value: body },
          ...(areaPath ? [{op:'add',path:'/fields/System.AreaPath',value:areaPath}] : []),
        ]);
      return asTicket(repository, raw);
    },
    comment: async (ticket, body) => {
      const raw = ticket.repository.split('/').length === 2 ? await github(`repos/${ticket.repository}/issues/${ticket.number}/comments`, 'POST', { body })
        : await azure(ticket.repository, 'comments', [`workItemId=${ticket.number}`], { text: body });
      return String(raw.id);
    },
    readComment: async (ticket, id) => {
      const raw = ticket.repository.split('/').length === 2 ? await github(`repos/${ticket.repository}/issues/comments/${id}`)
        : await azure(ticket.repository, 'comments', [`workItemId=${ticket.number}`, `commentId=${id}`]);
      return String(raw[ticket.repository.split('/').length === 2 ? 'body' : 'text'] ?? '');
    },
    replace: async (ticket, body) => {
      const fresh = await read(ticket.repository, ticket.number);
      if (ticket.repository.split('/').length === 2){
        if(JSON.stringify(readTrackerStructure(fresh.body))!==JSON.stringify(readTrackerStructure(ticket.body)))throw Error('The issue structure changed while saving. The pending save will recheck it.');
        const metadata=readTrackerStructure(body);if(!metadata)throw Error('The structural update has no metadata.');
        await markStructural(ticket.repository,ticket.number);
        // GitHub does not support conditional issue-body PATCH. Append metadata and never replace authored bytes.
        await github(`repos/${ticket.repository}/issues/${ticket.number}/comments`,'POST',{body:writeTrackerStructure('',metadata).trim()});
      } else {
        if (fresh.version !== ticket.version || fresh.body !== ticket.body) throw Error('The issue changed while saving its structure. The pending save will recheck it.');
        const [org,project]=ticket.repository.split('/');
        const folder=await mkdtemp(join(tmpdir(),'factory-structure-patch-'));
        try {
          const file=join(folder,'patch.json');
          await writeFile(file,JSON.stringify([{op:'test',path:'/rev',value:Number(ticket.version)}, {op:'add',path:'/fields/System.Description',value:body}]),{mode:0o600});
          await providerCommand('az',['rest','--method','patch','--resource','499b84ac-1321-427f-aa17-267ca6975798',
            '--url',`https://dev.azure.com/${org}/${encodeURIComponent(decodeURIComponent(project!))}/_apis/wit/workitems/${ticket.number}?api-version=7.1`,
            '--headers','Content-Type=application/json-patch+json','--body',`@${file}`,'--output','json']);
        } finally {await rm(folder,{recursive:true,force:true});}
      }
    },
  };
}

export async function readStructureSnapshot(ticket: StructureTicket, metadata: TrackerStructure, provider: StructureProvider, setups: readonly RepositorySetup[]): Promise<{ snapshot: TrackerSnapshot; digest: string }> {
  if (!metadata.snapshot) throw Error('This issue has no saved concept structure yet.');
  const rootRef = repoFromUrl(metadata.snapshot.root, setups, metadata.snapshot.repository);
  if(!setups.some(setup=>sameRepo(setup.repo,rootRef.repository)))throw Error(`Add ${rootRef.repository} before loading this saved structure.`);
  const root = rootRef.repository === ticket.repository && rootRef.number === ticket.number ? ticket : await provider.read(rootRef.repository, rootRef.number);
  const manifest = readTrackerStructure(root.body)?.snapshot;
  if (!manifest || manifest.root !== structureIssueUrl(root.repository, root.number)) throw Error('The concept has no committed structure manifest.');
  if (!manifest.chunks.length) throw Error('The saved concept structure has no chunks.');
  const chunks = await mapConcurrent(manifest.chunks,async ({ id, digest }, index) => {
    const body = await provider.readComment(root, id);
    const match = /^<!-- lar-factory:chunk ([a-f0-9-]{36}) (\d+)\n([A-Za-z0-9+/=]+)\n-->$/.exec(body);
    if (!match || match[1] !== manifest.generation || Number(match[2]) !== index || sha(match[3]!) !== digest) throw Error('A saved concept structure chunk is missing or changed.');
    return match[3]!;
  });
  const text = gunzipSync(Buffer.from(chunks.join(''), 'base64'), { maxOutputLength: 16 * 1024 * 1024 }).toString('utf8');
  if (sha(text) !== manifest.digest) throw Error('The saved concept structure checksum does not match.');
  const snapshot=validateTrackerSnapshot(JSON.parse(text));
  for(const node of snapshot.nodes)if(!setups.some(setup=>sameRepo(setup.repo,node.repository)))throw Error(`Add ${node.repository} before loading this saved structure.`);
  const rootNode=snapshot.nodes.find(node=>node.key===snapshot.root)!;
  if(rootNode.repository!==root.repository || !rootNode.ticket || numberOf(rootNode.ticket)!==root.number)throw Error('The saved structure root does not match its manifest.');
  if(!snapshot.nodes.some(node=>sameRepo(node.repository,ticket.repository)&&node.ticket&&numberOf(node.ticket)===ticket.number))throw Error('The saved structure does not contain this issue.');
  return { snapshot, digest: manifest.digest };
}

const running = new WeakMap<WorkRecords, Promise<void>>();
const retries = new WeakMap<WorkRecords, Map<string, {digest:string; after:number}>>();
export interface StructureSyncOptions { provider?: StructureProvider; setups?: RepositorySetup[]; dir?: string; workId?: string; confirmedMissingIssue?: string }
/** Drain structural changes. Failed saves stay in the durable outbox; changed remote generations are never overwritten. */
export function syncStructures(records: WorkRecords, options: StructureSyncOptions = {}): Promise<void> {
  const prior = running.get(records); if (prior) return prior;
  const task = drainDatabase(records, options).finally(() => running.delete(records)); running.set(records, task); return task;
}
class StaleStructure extends Error {}
function leaseProvider(provider: StructureProvider, lease: TrackerSyncLease): StructureProvider {
  return new Proxy(provider,{get(target,key,receiver){
    const method=Reflect.get(target,key,receiver);
    if(typeof method!=='function')return method;
    return async (...args:unknown[])=>{await lease.assertOwned();const value=await Reflect.apply(method,target,args);await lease.assertOwned();return value;};
  }});
}
async function drainDatabase(records: WorkRecords, options: StructureSyncOptions): Promise<void> {
  const database=records.trackerDatabasePath();
  let previousAfter: string | undefined;
  let first=true;
  for(;;){
    const lease=await acquireTrackerSyncLock(database);
    if(!lease)return;
    let lastSeen='';
    try{
      const provider=leaseProvider(options.provider ?? structureProvider(),lease);
      let passOptions=first ? {...options,provider} : {...options,provider,workId:undefined,confirmedMissingIssue:undefined};
      for(;;){
        const before=records.trackerPending();
        const beforeById=new Map(before.map(entry=>[entry.workId,entry.sequence]));
        await drain(records,passOptions);
        const after=records.trackerPending();lastSeen=JSON.stringify(after);
        const changed=after.some(entry=>entry.sequence>(beforeById.get(entry.workId) ?? -1));
        // An explicit request still drains other pending work once, since a busy CLI may have already returned.
        const otherWork=passOptions.workId!==undefined && after.length>0;
        if(!changed && !otherWork)break;
        passOptions={...options,provider,workId:undefined,confirmedMissingIssue:undefined};
      }
    }finally{await lease.release();}
    first=false;
    // Check after releasing: a caller that saw the lock busy necessarily committed its mutation before this read.
    const afterRelease=JSON.stringify(records.trackerPending());
    if(afterRelease===lastSeen || afterRelease===previousAfter)return;
    previousAfter=afterRelease;
  }
}
async function drain(records: WorkRecords, options: StructureSyncOptions): Promise<void> {
  let setups: RepositorySetup[];
  try { setups = options.setups ?? readRepositorySetups(options.dir ?? boardDataDir()); } catch { return; }
  const provider = options.provider ?? structureProvider();
  const pending = records.trackerPending();
  const sequence = Math.max(0, ...pending.map(entry => entry.sequence));
  const seen = new Set<string>();
  for (const entry of options.workId ? [{ workId: options.workId, sequence }] : pending) {
    let snapshot: TrackerSnapshot;
    try { snapshot = records.trackerSnapshot(entry.workId); } catch { continue; }
    if (seen.has(snapshot.root)) continue; seen.add(snapshot.root);
    const current=()=>{try{return trackerDigest(records.trackerSnapshot(entry.workId))===trackerDigest(snapshot);}catch{return false;}};
    const assertCurrent=()=>{if(!current())throw new StaleStructure();};
    const structural = hasTrackerStructure(snapshot);
    const configs = snapshot.nodes.map(node => setups.find(setup => sameRepo(setup.repo, node.repository)));
    if (configs.some(setup => setup?.structureSync === false)) continue;
    const checkpoint = records.trackerCheckpoint(entry.workId);
    if(checkpoint.conflict && !options.workId) continue;
    if (!structural) {
      if(checkpoint.remoteDigest){
        try {
          for(const node of snapshot.nodes){
            if(!node.ticket)continue;
            const setup=setups.find(setup=>sameRepo(setup.repo,node.repository));
            if(!setup || structureSyncOperations(node.repository).filter(operation=>operation!=='publish-ticket').some(operation=>setup.access[operation]!=='allowed'))throw Error(`${node.repository}: issue editing access is unverified. Check access in repository settings.`);
            const ticket=await provider.read(node.repository,numberOf(node.ticket));const prior=readTrackerStructure(ticket.body);
            if(!prior?.snapshot)continue;
            if(prior.identity!==node.key || prior.snapshot.digest!==checkpoint.remoteDigest){if(current())records.trackerFailed(entry.workId,'This issue changed on another machine. Its pending structural removal was kept.',true,trackerDigest(snapshot));throw Error('Structural removal conflicts with another machine.');}
            assertCurrent();
            await provider.replace(ticket,writeTrackerStructure(ticket.body,{version:1,kind:node.kind,identity:node.key,repository:node.repository}));
          }
        }catch(error){if(error instanceof TrackerSyncLockLost)throw error;if(!(error instanceof StaleStructure)&&current())records.trackerFailed(entry.workId,fail(error),true,trackerDigest(snapshot));continue;}
      }
      records.trackerSaved(entry.workId, sequence, trackerDigest(snapshot), ''); continue;
    }
    const retryMap = retries.get(records) ?? new Map<string,{digest:string;after:number}>(); retries.set(records,retryMap);
    const fingerprint = trackerDigest(snapshot);
    const retry = retryMap.get(snapshot.root);
    if (!options.workId && retry?.digest === fingerprint && Date.now() < retry.after) continue;
    if (trackerDigest(snapshot) === checkpoint.localDigest && !checkpoint.error) { records.trackerSaved(entry.workId, sequence, checkpoint.localDigest, checkpoint.remoteDigest ?? ''); continue; }
    try {
      for (let index = 0; index < configs.length; index++) {
        const setup = configs[index];
        if (!setup) throw Error(`Add ${snapshot.nodes[index]!.repository} before saving this concept's structure.`);
        for (const operation of structureSyncOperations(setup.repo)) {
          if (setup.access[operation] !== 'allowed') throw Error(`${setup.repo}: issue ${operation === 'publish-ticket' ? 'creation' : operation === 'edit-ticket' ? 'editing' : operation==='tag-ticket' ? 'labeling' : 'comments'} access is ${setup.access[operation]}. Check access in repository settings.`);
        }
      }
      // A dependency's existing owner issue is a durable member too, so it can recover the graph from its own List.
      for(const node of snapshot.nodes){
        if(node.ticket && !records.trackerWorkId(node.key)){
          const remote=await provider.read(node.repository,numberOf(node.ticket));
          records.trackerRememberMember({...node,kind:remote.kind ?? node.kind},remote.title || node.title,stripTrackerStructure(remote.body));
        }
      }
      snapshot=records.trackerSnapshot(entry.workId);
      // Stable public identities reconcile an uncertain create before a second request is possible.
      for (const node of snapshot.nodes) {
        if (node.ticket) continue;
        const matches = await provider.find(node.repository, node.key);
        if (matches.length > 1) throw Error('More than one issue has this concept part identity. Resolve the duplicate before saving.');
        const setup = setups.find(setup => sameRepo(setup.repo, node.repository))!;
        const marker: TrackerStructure = { version: 1, kind: node.kind, identity: node.key, repository:node.repository };
        const target = node.repository.split('/').length !== 2 && setup.itemSource?.kind === 'azure-board'
          ? await provider.creationTarget?.(node.repository,setup.itemSource.team) : undefined;
        assertCurrent();
        if (!matches.length) {
          if (options.confirmedMissingIssue === node.key) records.trackerClearCreation(node.key);
          if (!records.trackerReserveCreation(node.key)) throw Error(`Issue creation for ${node.title} is unconfirmed. Check the tracker before retrying with --confirmed-missing-issue ${node.key}.`);
        }
        const created = matches[0] ?? await provider.create(node.repository, node.title, writeTrackerStructure('', marker), target?.type ?? setup.vocabulary?.[node.kind as 'concept']?.type ?? undefined,target?.areaPath);
        // Imported identities may differ from their local cache IDs.
        const localId = records.trackerWorkId(node.key);
        const local = localId ? records.read(localId) : undefined;
        if (!local) throw Error('The concept part changed while its issue was created. Its issue identity remains available for recovery.');
        records.attachTicket(local.workId, local.revision, `${node.repository}#${created.number}`);
        records.trackerClearCreation(node.key);
        node.ticket = `${node.repository}#${created.number}`;
      }
      const snapshotSequence = Math.max(sequence, ...records.trackerPending().map(item => item.sequence));
      snapshot = records.trackerSnapshot(entry.workId);
      const root = snapshot.nodes.find(node => node.key === snapshot.root)!;
      const rootTicket = await provider.read(root.repository, numberOf(root.ticket!));
      const remote = readTrackerStructure(rootTicket.body);
      const remoteDigest = remote?.snapshot?.digest ?? null;
      assertCurrent();
      const payload = JSON.stringify(snapshot); const digest = sha(payload);
      const alreadyCommitted = remoteDigest === digest ? remote?.snapshot : undefined;
      if (checkpoint.remoteDigest !== remoteDigest && remoteDigest !== null && !alreadyCommitted) {
        if(current())records.trackerFailed(entry.workId, 'This concept changed on another machine. Your pending structure was kept. Resolve the two versions before saving.', true,trackerDigest(snapshot)); continue;
      }
      let manifest = alreadyCommitted;
      if (!manifest) {
        const generation = randomUUID();
        const encoded = gzipSync(payload).toString('base64');
        const chunks: { id: string; digest: string }[] = [];
        for (let offset = 0, index = 0; offset < encoded.length; offset += 48_000, index++) {
          const data = encoded.slice(offset, offset + 48_000);
          assertCurrent();
          const id = await provider.comment(rootTicket, `<!-- lar-factory:chunk ${generation} ${index}\n${data}\n-->`);
          chunks.push({ id, digest: sha(data) });
        }
        manifest = { root: structureIssueUrl(root.repository, rootTicket.number), repository:root.repository, generation, digest, previous:remote?.snapshot?.root===structureIssueUrl(root.repository,rootTicket.number) ? remoteDigest : null, chunks };
      }
      const part = (node: StructureNode): TrackerPart => ({ url: structureIssueUrl(node.repository, numberOf(node.ticket!)), title: node.title, kind: node.kind, repository:node.repository });
      const metadata = (node: StructureNode): TrackerStructure => ({ version: 1, kind: node.kind, identity: node.key, repository:node.repository, snapshot: manifest,
        ...(node.kind === 'concept' && node.map && node.map.length < 24_000 ? { map: node.map } : {}),
        ...(node.parent ? { parent: part(snapshot.nodes.find(parent => parent.key === node.parent)!) } : {}),
        parts: snapshot.nodes.filter(child => child.parent === node.key).map(part),
        blockers: node.blockers.map(key => part(snapshot.nodes.find(blocker => blocker.key === key)!)),
        connections: snapshot.nodes.filter(other => other.repository !== node.repository).map(part),
        dependencies: snapshot.dependencies.filter(dependency => dependency.work === node.key).map(({key:_key,work:_work,blocks,...dependency}) => ({...dependency,blocks:blocks.map(key => part(snapshot.nodes.find(build=>build.key===key)!).url)})),
      });
      // Commit the root first. Child projections resolve the latest committed root generation on every import.
      assertCurrent();
      if (!alreadyCommitted) await provider.replace(rootTicket, writeTrackerStructure(rootTicket.body, metadata(root)));
      records.trackerCommitted(snapshot.root,digest);
      const verifiedRoot = await provider.read(root.repository, rootTicket.number);
      if (readTrackerStructure(verifiedRoot.body)?.snapshot?.digest !== digest) throw Error('The tracker did not preserve the structure manifest. The local structure remains pending.');
      for (const node of snapshot.nodes.filter(node => node.key !== root.key)) {
        const ticket = await provider.read(node.repository, numberOf(node.ticket!));
        assertCurrent();
        const next=metadata(node);
        if(JSON.stringify(readTrackerStructure(ticket.body))!==JSON.stringify(next))await provider.replace(ticket, writeTrackerStructure(ticket.body, next));
      }
      assertCurrent();
      records.trackerSaved(entry.workId, snapshotSequence, trackerDigest(snapshot), digest);
    } catch (error) {
      if(error instanceof TrackerSyncLockLost)throw error;
      if(error instanceof StaleStructure || !current())continue;
      records.trackerFailed(entry.workId, fail(error), /concurrent tracker versions|changed on another machine/i.test(fail(error)),trackerDigest(snapshot));
      retryMap.set(snapshot.root,{digest:trackerDigest(snapshot),after:Date.now()+30_000});
    }
  }
}
