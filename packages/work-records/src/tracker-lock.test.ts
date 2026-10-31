import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { acquireTrackerSyncLock, TrackerSyncLockLost } from './tracker-lock.ts';
const folders:string[]=[];
const children:ChildProcess[]=[];
afterEach(async()=>{
  for(const child of children.splice(0)){if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
  await Promise.all(folders.splice(0).map(folder=>rm(folder,{recursive:true,force:true})));
});
async function database(){const folder=await mkdtemp(join(tmpdir(),'structure-lock-'));folders.push(folder);const path=join(folder,'work.db');await writeFile(path,'');return path;}

test('independent callers and symlinked database paths share one atomic lease',async()=>{
  const path=await database();const alias=`${path}.alias`;await symlink(path,alias);
  const first=await acquireTrackerSyncLock(path);expect(first).not.toBeNull();
  expect(await acquireTrackerSyncLock(alias)).toBeNull();await first!.assertOwned();await first!.release();
  const next=await acquireTrackerSyncLock(alias);expect(next).not.toBeNull();await next!.release();
});

test('a separate process excludes other writers, and its dead lease is recovered',async()=>{
  const path=await database();
  const moduleUrl=new URL('./tracker-lock.ts',import.meta.url).href;
  const child=spawn(process.execPath,['--input-type=module','-e',
    `import {acquireTrackerSyncLock} from ${JSON.stringify(moduleUrl)}; await acquireTrackerSyncLock(${JSON.stringify(path)});process.stdout.write('locked');setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe'],env:{...process.env,TZ:'Pacific/Honolulu'}});
  children.push(child);let stderr='';child.stderr!.on('data',chunk=>{stderr+=String(chunk);});
  await Promise.race([once(child.stdout!,'data'),once(child,'exit').then(()=>{throw Error(`Lock child exited: ${stderr}`);})]);
  expect(await acquireTrackerSyncLock(path)).toBeNull();
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const next=await acquireTrackerSyncLock(path);expect(next).not.toBeNull();await next!.assertOwned();await next!.release();
});

test('a former owner cannot release or use a replacement generation',async()=>{
  const path=await database();const first=await acquireTrackerSyncLock(path);expect(first).not.toBeNull();
  const lock=`${path}.structure-sync.lock`;const owner=JSON.parse(await readFile(lock,'utf8')) as {pid:number;token:string};
  await unlink(lock);const replacement={...owner,token:'12345678-1234-1234-1234-123456789abc'};await writeFile(lock,JSON.stringify(replacement));
  await expect(first!.assertOwned()).rejects.toBeInstanceOf(TrackerSyncLockLost);await first!.release();
  expect(JSON.parse(await readFile(lock,'utf8'))).toEqual(replacement);
});

test.each(['reboot', 'reused-pid'])('an abandoned lease recovers after %s even when its PID is live', async (reason) => {
  const path = await database();
  const held = await acquireTrackerSyncLock(path);
  const lock = `${path}.structure-sync.lock`;
  const owner = JSON.parse(await readFile(lock, 'utf8')) as { pid: number; token: string; identity: string };
  await held!.release();
  const identity = reason === 'reboot' ? `previous-boot:${owner.identity.split(':').slice(1).join(':')}` : `${owner.identity}-previous-process`;
  await writeFile(lock, JSON.stringify({ ...owner, identity }));
  const next = await acquireTrackerSyncLock(path);
  expect(next).not.toBeNull();
  await next!.assertOwned();
  await next!.release();
});
