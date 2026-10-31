// Structural snapshots exclude queue order, Status, briefs, decision answers, slices and thread progress.
import { createHash, randomUUID } from 'node:crypto';
import type { Item, Kind, TrackerDependency } from '@lar-factory/shared';
import { trackerPullRequestReference, trackerIssueUrl, trackerPullRequestUrl } from '@lar-factory/shared';
import type { Database } from './database.ts';
import { WorkRecordError } from './database.ts';
import { validateTrackerSnapshot } from './tracker-snapshot.ts';

type Row = Record<string, string | number | null>;
export interface StructureNode {
  key: string; repository: string; kind: Kind; title: string; ticket: string | null;
  parent: string | null; blockers: string[]; map?: string;
}
interface StructureDependency extends Omit<TrackerDependency, 'blocks'> { key: string; work: string; blocks: string[] }
export interface TrackerSnapshot { version: 1; root: string; nodes: StructureNode[]; dependencies: StructureDependency[] }
interface TrackerCheckpoint { localDigest: string | null; remoteDigest: string | null; error: string | null; conflict: boolean }
export interface TrackerCache {
  trackerDatabasePath(): string;
  trackerCommitted(rootKey: string, remoteDigest: string): void;
  trackerSnapshot(workId: string): TrackerSnapshot;
  trackerReserveCreation(sourceKey: string): boolean;
  trackerClearCreation(sourceKey: string): void;
  trackerWorkId(sourceKey: string): string | undefined;
  trackerRememberMember(node: StructureNode, title: string, context: string): void;
  trackerRestore(snapshot: unknown, remoteDigest: string, sourceContexts?: Readonly<Record<string,string>>): string;
  trackerPending(): { workId: string; sequence: number }[];
  trackerCheckpoint(workId: string): TrackerCheckpoint;
  trackerSaved(workId: string, sequence: number, localDigest: string, remoteDigest: string): void;
  trackerFailed(workId: string, error: string, conflict?: boolean, expectedDigest?: string): void;
  trackerState(workId: string): Item['sync'];
}
export const hasTrackerStructure = (snapshot: TrackerSnapshot): boolean => {
  const repositories=new Set(snapshot.nodes.map(node=>node.repository.toLowerCase()));
  return snapshot.nodes.some(node=>node.kind==='concept') || repositories.size>1 || snapshot.dependencies.some(dependency=>!repositories.has(dependency.owner.toLowerCase()));
};
export const trackerDigest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = (message: string): never => { throw new WorkRecordError('invalid', message); };
const publicMap = (map: string) => map.replace(/^## Domain docs\s*\n[\s\S]*?(?=^## |$(?![\s\S]))/gmi, '');

export function trackerCache(database: Database): TrackerCache {
  const { db } = database;
  const sourceKey = (id: string) => String(db.prepare('SELECT source_key FROM tracker_identities WHERE work_id = ?').get(id)?.source_key ?? id);
  const graph = () => {
    const all=db.prepare("SELECT * FROM work_records WHERE kind <> 'slice' ORDER BY work_id").all() as Row[];
    const blockers=db.prepare('SELECT * FROM blockers ORDER BY work_id,blocker_id').all() as Row[];
    const edges=[...blockers];const dependencyTargets=new Set<string>();
    for(const dependency of db.prepare('SELECT work_id,ticket,need FROM dependencies WHERE ticket IS NOT NULL ORDER BY dependency_id').all()){
      const ticket=String(dependency.ticket);let target=all.find(row=>String(row.ticket).toLowerCase()===ticket.toLowerCase());
      if(!target){
        const hex=createHash('sha256').update(`dependency-ticket:${ticket.toLowerCase()}`).digest('hex').slice(0,32);
        const key=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
        target={work_id:key,repository:ticket.slice(0,ticket.lastIndexOf('#')),ticket,kind:'issue',title:String(dependency.need).split('\n')[0]!.slice(0,1024),parent_id:null};all.push(target);
      }
      dependencyTargets.add(String(target.work_id));edges.push({work_id:String(dependency.work_id),blocker_id:String(target.work_id)});
    }
    return {all,edges,blockers,dependencyTargets};
  };

  const rootOf = (workId: string) => {
    const seen = new Set<string>();
    let root = workId;
    for (;;) {
      if (seen.has(root)) invalid('The saved issue has a parent cycle.');
      seen.add(root);
      const row = db.prepare('SELECT parent_id FROM work_records WHERE work_id = ?').get(root);
      if (!row) throw new WorkRecordError('not-found', 'The saved issue has no work record.');
      if (!row.parent_id) break;
      root = String(row.parent_id);
    }
    const {all,edges,dependencyTargets}=graph();
    const ids=new Set([root]);
    for(let changed=true;changed;){
      changed=false;
      const add=(id:string)=>{if(!ids.has(id)&&all.some(row=>row.work_id===id)){ids.add(id);changed=true;}};
      for(const row of all){if(row.parent_id&&ids.has(String(row.parent_id)))add(String(row.work_id));if(ids.has(String(row.work_id))&&row.parent_id)add(String(row.parent_id));}
      for(const edge of edges){if(ids.has(String(edge.work_id)))add(String(edge.blocker_id));if(ids.has(String(edge.blocker_id)))add(String(edge.work_id));}
    }
    const roots=all.filter(row=>ids.has(String(row.work_id))&&!row.parent_id);
    const owners=roots.filter(row=>!dependencyTargets.has(String(row.work_id)));
    const candidates=(owners.length?owners:roots).sort((a,b)=>Number(b.kind==='concept')-Number(a.kind==='concept')||sourceKey(String(a.work_id)).localeCompare(sourceKey(String(b.work_id))));
    return candidates.length ? String(candidates[0]!.work_id) : root;
  };
  const snapshot = (workId: string): TrackerSnapshot => {
    const root = rootOf(workId);
    const {all,edges,blockers}=graph();
    const ids = new Set([root]);
    for (let changed = true; changed;) {
      changed = false;
      const add = (id: string) => { if (!ids.has(id) && all.some(row => row.work_id === id)) { ids.add(id); changed = true; } };
      for (const row of all) {
        if (row.parent_id && ids.has(String(row.parent_id))) add(String(row.work_id));
        if (ids.has(String(row.work_id)) && row.parent_id) add(String(row.parent_id));
      }
      for (const row of edges) {
        if (ids.has(String(row.work_id))) add(String(row.blocker_id));
        if (ids.has(String(row.blocker_id))) add(String(row.work_id));
      }
    }
    const nodes = all.filter(row => ids.has(String(row.work_id))).map((row): StructureNode => {
      const id = String(row.work_id);
      const map = row.kind === 'concept' ? db.prepare("SELECT markdown FROM bodies WHERE work_id = ? AND body = 'map'").get(id)?.markdown : undefined;
      return { key: sourceKey(id), repository: String(row.repository), kind: row.kind as Kind, title: String(row.title), ticket: row.ticket as string | null,
        parent: row.parent_id ? sourceKey(String(row.parent_id)) : null,
        blockers: blockers.filter(edge => edge.work_id === id && ids.has(String(edge.blocker_id))).map(edge => sourceKey(String(edge.blocker_id))).sort(),
        ...(map !== undefined ? { map: publicMap(String(map)) } : {}) };
    });
    const referenceUrl = (reference: string, pr=false) => {
      const split=reference.lastIndexOf('#');const repo=reference.slice(0,split);const number=Number(reference.slice(split+1));
      return pr ? trackerPullRequestUrl(repo,number) : trackerIssueUrl(repo,number);
    };
    const dependencies = (db.prepare('SELECT * FROM dependencies ORDER BY dependency_id').all() as Row[]).filter(row => ids.has(String(row.work_id))).map((row): StructureDependency => ({
      key: String(row.dependency_id), work: sourceKey(String(row.work_id)), need: String(row.need), owner: String(row.owner),
      contract: String(row.contract), evidence: String(row.evidence), handover: String(row.handover),
      ...(row.ticket ? { ticket: referenceUrl(String(row.ticket)) } : {}),
      pullRequests: (JSON.parse(String(row.pull_requests)) as string[]).map(ref => referenceUrl(ref,true)),
      blocks: db.prepare('SELECT build_id FROM dependency_blocks WHERE dependency_id = ? ORDER BY build_id').all(String(row.dependency_id)).map(block => sourceKey(String(block.build_id))).sort(),
    }));
    return { version: 1, root: sourceKey(root), nodes: nodes.sort((a, b) => a.key.localeCompare(b.key)), dependencies };
  };
  const checkpoint = (workId: string): TrackerCheckpoint => {
    const row = db.prepare('SELECT * FROM tracker_sync WHERE work_id = ?').get(sourceKey(rootOf(workId)));
    return { localDigest: row?.local_digest as string | null ?? null, remoteDigest: row?.remote_digest as string | null ?? null,
      error: row?.error as string | null ?? null, conflict: row?.conflict === 1 };
  };
  const pending = () => db.prepare('SELECT work_id, sequence FROM tracker_outbox ORDER BY sequence').all()
    .map(row => ({ workId: String(row.work_id), sequence: Number(row.sequence) }));
  return {
    trackerDatabasePath: () => database.read(() => String(db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file ?? '')),
    trackerCommitted: (rootKey,remoteDigest) => database.write(() => {
      db.prepare(`INSERT INTO tracker_sync(work_id,remote_digest) VALUES (?,?) ON CONFLICT(work_id) DO UPDATE SET remote_digest=excluded.remote_digest`).run(rootKey,remoteDigest);
    }),
    trackerReserveCreation: key => database.write(() => Number(db.prepare('INSERT OR IGNORE INTO tracker_creations(source_key) VALUES (?)').run(key).changes) === 1),
    trackerClearCreation: key => database.write(() => {db.prepare('DELETE FROM tracker_creations WHERE source_key=?').run(key);}),
    trackerWorkId: key => database.read(() => {
      const row = db.prepare('SELECT work_id FROM tracker_identities WHERE source_key = ?').get(key) ?? db.prepare('SELECT work_id FROM work_records WHERE work_id = ?').get(key);
      return row ? String(row.work_id) : undefined;
    }),
    trackerRememberMember: (node,title,context) => database.write(() => {
      if(!node.ticket)invalid('A dependency member must already have an issue.');
      const held=db.prepare('SELECT work_id FROM work_records WHERE lower(ticket)=lower(?)').get(node.ticket);
      const id=String(held?.work_id ?? randomUUID());const at=new Date().toISOString();
      if(!held)db.prepare(`INSERT INTO work_records(work_id,repository,kind,status,ticket,revision,created_at,updated_at,title,initial_context)
        VALUES (?,?,?,'List',?,1,?,?,?,?)`).run(id,node.repository,node.kind,node.ticket,at,at,title,context);
      db.prepare('INSERT OR IGNORE INTO tracker_identities(source_key,work_id) VALUES (?,?)').run(node.key,id);
    }),
    trackerSnapshot: workId => database.read(() => snapshot(workId)),
    trackerPending: () => database.read(pending),
    trackerCheckpoint: workId => database.read(() => checkpoint(workId)),
    trackerSaved: (workId, sequence, localDigest, remoteDigest) => database.write(() => {
      const state = snapshot(workId); const root = rootOf(workId);
      const save=db.prepare(`INSERT INTO tracker_sync(work_id, local_digest, remote_digest, error, conflict) VALUES (?, ?, ?, NULL, 0)
        ON CONFLICT(work_id) DO UPDATE SET local_digest=excluded.local_digest, remote_digest=excluded.remote_digest, error=NULL, conflict=0`);
      // Each member retains its last saved membership so a later split can retire its old marker.
      for(const node of state.nodes)save.run(node.key,localDigest,remoteDigest);
      if(!state.nodes.length)save.run(sourceKey(root),localDigest,remoteDigest);
      const keys = new Set(state.nodes.map(node => node.key));
      for (const dirty of pending()) if (keys.has(sourceKey(dirty.workId)) || keys.has(sourceKey(rootOf(dirty.workId)))) db.prepare('DELETE FROM tracker_outbox WHERE work_id = ? AND sequence <= ?').run(dirty.workId, sequence);
    }),
    trackerFailed: (workId, error, conflict = false, expectedDigest) => database.write(() => {
      if(expectedDigest !== undefined && trackerDigest(snapshot(workId)) !== expectedDigest)return;
      db.prepare(`INSERT INTO tracker_sync(work_id, error, conflict) VALUES (?, ?, ?)
        ON CONFLICT(work_id) DO UPDATE SET error=excluded.error, conflict=excluded.conflict`).run(sourceKey(rootOf(workId)), error, Number(conflict));
    }),
    trackerState: workId => database.read(() => {
      const state = checkpoint(workId);
      if (state.error) return { state: state.conflict ? 'conflict' : 'error', message: state.error };
      const snap = snapshot(workId);
      if (!hasTrackerStructure(snap)) return undefined;
      return { state: trackerDigest(snap) === state.localDigest ? 'saved' : 'pending' };
    }),
    trackerRestore: (input, remoteDigest, sourceContexts = {}) => database.write(() => {
      const value = validateTrackerSnapshot(input);
      // Importing a newly discovered part must never clear another part's pending local structural edits.
      for (const node of value.nodes) {
        const existing = node.ticket ? db.prepare('SELECT work_id FROM work_records WHERE lower(ticket)=lower(?)').get(node.ticket) : undefined;
        const identity = db.prepare('SELECT work_id FROM tracker_identities WHERE source_key=?').get(node.key);
        const id = existing?.work_id ?? identity?.work_id;
        if (id && trackerDigest(snapshot(String(id))) !== checkpoint(String(id)).localDigest) {
          throw new WorkRecordError('stale-revision', 'This concept has pending local structure. Save or resolve it before importing another tracker version.');
        }
      }
      const mapping = new Map<string, string>();
      const at = new Date().toISOString();
      for (const node of value.nodes) {
        const existing = node.ticket ? db.prepare('SELECT work_id FROM work_records WHERE lower(ticket) = lower(?)').get(node.ticket) : undefined;
        const identity = db.prepare('SELECT work_id FROM tracker_identities WHERE source_key = ?').get(node.key);
        const id = String(existing?.work_id ?? identity?.work_id ?? randomUUID()); mapping.set(node.key, id);
        if (!existing && !identity) db.prepare(`INSERT INTO work_records(work_id, repository, kind, status, ticket, revision, created_at, updated_at, title, initial_context)
          VALUES (?, ?, ?, 'List', ?, 1, ?, ?, ?, ?)`).run(id, node.repository, node.kind, node.ticket, at, at, node.title,node.ticket ? sourceContexts[node.ticket] ?? '' : '');
        db.prepare('INSERT OR IGNORE INTO tracker_identities(source_key, work_id) VALUES (?, ?)').run(node.key, id);
      }
      const ids = new Set(mapping.values());
      // Keep local refinement/status intact. Fresh caches receive only structural relationships and concept maps.
      for (const node of value.nodes) {
        const id = mapping.get(node.key)!;
        const row = db.prepare('SELECT parent_id, kind FROM work_records WHERE work_id = ?').get(id)!;
        if (node.parent && !row.parent_id) db.prepare('UPDATE work_records SET parent_id = ?, kind = ? WHERE work_id = ?').run(mapping.get(node.parent)!, node.kind, id);
        if (node.map !== undefined && !db.prepare("SELECT 1 FROM bodies WHERE work_id = ? AND body='map'").get(id)) {
          const written = Number(db.prepare('SELECT coalesce(max(written), 0)+1 AS n FROM bodies').get()?.n);
          db.prepare("INSERT INTO bodies(work_id, body, markdown, written, has_content, has_passing_gate) VALUES (?, 'map', ?, ?, ?, 0)").run(id, node.map, written, Number(Boolean(node.map.trim())));
        }
        for (const blocker of node.blockers) db.prepare('INSERT OR IGNORE INTO blockers(work_id, blocker_id) VALUES (?, ?)').run(id, mapping.get(blocker)!);
      }
      const asReference = (url: string, pr=false) => {
        if(pr){const ref=trackerPullRequestReference(url)!;return `${ref.repository}#${ref.number}`;}
        const node=value.nodes.find(node=>node.ticket && trackerIssueUrl(node.repository,Number(node.ticket.slice(node.ticket.lastIndexOf('#')+1)))===url)!;
        return node.ticket!;
      };
      for (const dependency of value.dependencies) {
        const id = mapping.get(dependency.work)!;
        if (!db.prepare('SELECT 1 FROM dependencies WHERE dependency_id=?').get(dependency.key)) db.prepare(`INSERT INTO dependencies
          (dependency_id,work_id,need,owner,contract,evidence,ticket,pull_requests,handover,met_by,met_at,revision,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(dependency.key,id,dependency.need,dependency.owner,dependency.contract ?? '',dependency.evidence ?? '',
          dependency.ticket ? asReference(dependency.ticket) : null,JSON.stringify((dependency.pullRequests ?? []).map(url => asReference(url,true))),dependency.handover ?? '',null,null,at,at);
        for (const build of dependency.blocks) db.prepare('INSERT OR IGNORE INTO dependency_blocks(dependency_id,build_id) VALUES (?,?)').run(dependency.key,mapping.get(build)!);
      }
      const root = mapping.get(value.root)!;
      for (const id of ids) db.prepare('DELETE FROM tracker_outbox WHERE work_id = ?').run(id);
      const saved=db.prepare(`INSERT INTO tracker_sync(work_id, local_digest, remote_digest, error, conflict) VALUES (?, ?, ?, NULL, 0)
        ON CONFLICT(work_id) DO UPDATE SET local_digest=excluded.local_digest, remote_digest=excluded.remote_digest, error=NULL, conflict=0`);
      const localDigest=trackerDigest(snapshot(root));
      for(const node of value.nodes)saved.run(node.key,localDigest,remoteDigest);
      return root;
    }),
  };
}
