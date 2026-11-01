import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords } from './work-records.ts';

test('an already-applied structural schema without creation reservations upgrades without losing local maps or progress',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'tracker-upgrade-'));const path=join(dir,'work-records.db');
  const root='11111111-1111-4111-8111-111111111111';const build='22222222-2222-4222-8222-222222222222';
  try {
    const earlier=await openDatabase(path,{migrations:MIGRATIONS.slice(0,10)});
    const insert=earlier.db.prepare(`INSERT INTO work_records(work_id,repository,kind,status,revision,created_at,updated_at,title,initial_context) VALUES (?,'team/server',?,?,1,'2026-10-31','2026-10-31',?,'Original context')`);
    insert.run(root,'concept','Shaping','Existing concept');insert.run(build,'build','Queued','Existing build');
    earlier.db.prepare("INSERT INTO bodies(work_id,body,markdown,written,has_content,has_passing_gate) VALUES (?,?,?,1,1,0)").run(root,'map','## Destination\nPreserve the map.');
    earlier.db.prepare("INSERT INTO bodies(work_id,body,markdown,written,has_content,has_passing_gate) VALUES (?,?,?,2,1,0)").run(build,'brief','PRIVATE LOCAL BRIEF');
    earlier.db.exec('DROP TABLE tracker_creations');earlier.close();
    const upgraded=await openWorkRecords(path);
    try {
      expect(upgraded.read(root).status).toBe('Shaping');expect(upgraded.body(root,'map')).toContain('Preserve the map.');
      expect(upgraded.read(build).status).toBe('Queued');expect(upgraded.body(build,'brief')).toBe('PRIVATE LOCAL BRIEF');
      expect(upgraded.trackerReserveCreation(root)).toBe(true);expect(upgraded.trackerReserveCreation(root)).toBe(false);
      upgraded.trackerClearCreation(root);expect(upgraded.trackerReserveCreation(root)).toBe(true);
      expect(upgraded.trackerPending().map(entry=>entry.workId).sort()).toEqual([root,build]);
    } finally {upgraded.close();}
  } finally {rmSync(dir,{recursive:true,force:true});}
});
