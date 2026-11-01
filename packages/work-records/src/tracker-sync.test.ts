import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { readTrackerStructure, type RepositorySetup } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from './work-records.ts';
import { readStructureSnapshot, syncStructures, structureProvider, type StructureProvider, type StructureTicket } from './tracker-sync.ts';
import { trackerDigest } from './tracker-cache.ts';

const handles: {records:WorkRecords;dir:string}[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const {records,dir} of handles.splice(0)) {records.close();rmSync(dir,{recursive:true,force:true});} });
async function cache() {const dir=mkdtempSync(join(tmpdir(),'structure-'));const records=await openWorkRecords(join(dir,'work-records.db'));handles.push({records,dir});return records;}
const settings=(repo:string,structureSync=true):RepositorySetup => ({repo,structureSync,access:{'publish-ticket':'allowed','edit-ticket':'allowed','comment-ticket':'allowed','tag-ticket':'allowed'},vocabulary:{}} as unknown as RepositorySetup);
function fakeProvider() {
  const issues=new Map<string,StructureTicket>();const comments=new Map<string,string>();const writes:string[]=[];
  let counter=100;let commentCount=1000;let failComment=0;
  const key=(repo:string,number:number)=>`${repo}#${number}`;
  const put=(repository:string,number:number,body='Author text.\n')=>{issues.set(key(repository,number),{repository,number,body,version:'1'});};
  const read=async(repository:string,number:number)=>{const ticket=issues.get(key(repository,number));if(!ticket)throw Error('No issue.');return {...ticket};};
  const provider:StructureProvider={read,
    find:async(repo,id)=>[...issues.values()].filter(issue=>issue.repository===repo && readTrackerStructure(issue.body)?.identity===id),
    create:async(repo,title,body)=>{writes.push(`create ${repo} ${title}`);put(repo,++counter,body);return read(repo,counter);},
    comment:async(ticket,body)=>{writes.push('comment');if(failComment && --failComment===0)throw Error('Comment unavailable.');const id=String(++commentCount);comments.set(id,body);return id;},
    readComment:async(_ticket,id)=>{const body=comments.get(id);if(!body)throw Error('No comment.');return body;},
    replace:async(ticket,body)=>{const current=await read(ticket.repository,ticket.number);if(current.version!==ticket.version)throw Error('Issue changed.');writes.push(`replace ${key(ticket.repository,ticket.number)}`);issues.set(key(ticket.repository,ticket.number),{...ticket,body,version:String(Number(ticket.version)+1)});},
  };
  put('team/relay',6,'Relay author text.');
  return {provider,issues,comments,writes,put,failComment:(n:number)=>{failComment=n;}};
}
const MAP='## Destination\nWatch anywhere.\n\n## Decisions so far\n- Use a shared contract.\n\n## Fog\n- none\n\n## Domain docs\n- PRIVATE DOMAIN DRAFT\n\n## Map\n```mermaid\nflowchart LR\n A[Server] --> B[Apple]\n```\n';
async function concept(records:WorkRecords) {
  let root=records.create({repository:'team/server',title:'Watch anywhere',kind:'concept',ticket:'team/server#42'});
  root=records.setBody(root.workId,root.revision,'map',MAP);
  let decision=records.create({repository:'team/server',title:'Choose contract',kind:'decision'});
  decision=records.setParent(decision.workId,decision.revision,root.workId);
  decision=records.setBody(decision.workId,decision.revision,'decision','PRIVATE DECISION');
  decision=records.setBody(decision.workId,decision.revision,'answer','PRIVATE ANSWER');
  let build=records.create({repository:'team/apple',title:'Play media',kind:'build'});
  build=records.setParent(build.workId,build.revision,root.workId);
  build=records.setBody(build.workId,build.revision,'brief','PRIVATE BRIEF');
  build=records.update(build.workId,build.revision,{status:'Queued'});
  let slice=records.create({repository:'team/apple',title:'PRIVATE SLICE',kind:'slice'});
  slice=records.setParent(slice.workId,slice.revision,build.workId);
  const dependency=records.addDependency(root.workId,{need:'Relay contract',owner:'team/relay',ticket:'team/relay#6',contract:'Stream URL',evidence:'Version 1'});
  records.addDependencyBlock(dependency.dependencyId,dependency.revision,build.workId);
  return {root,build,decision,slice};
}

test('concept and cross-repository structure round trips through tracker, while progress and private refinement stay local',async()=>{
  const records=await cache();const {root,build}=await concept(records);const fake=fakeProvider();fake.put('team/server',42);
  const setups=[settings('team/server'),settings('team/apple'),settings('team/relay')];
  await syncStructures(records,{provider:fake.provider,setups});
  expect(records.trackerState(root.workId)).toEqual({state:'saved'});
  expect(fake.writes.filter(write=>write.startsWith('create'))).toHaveLength(2);
  const saved=await fake.provider.read('team/server',42);expect(saved.body.startsWith('Author text.\n')).toBe(true);
  const metadata=readTrackerStructure(saved.body)!;expect(metadata.parts).toHaveLength(2);expect(metadata.connections?.some(connection=>connection.url.includes('/team/apple/'))).toBe(true);
  const {snapshot,digest}=await readStructureSnapshot(saved,metadata,fake.provider,setups);
  const encoded=JSON.stringify(snapshot);expect(encoded).toContain('flowchart LR');
  for(const privateText of ['PRIVATE BRIEF','PRIVATE DECISION','PRIVATE ANSWER','PRIVATE SLICE','PRIVATE DOMAIN DRAFT','Queued','queueOrder','buildPhase'])expect(encoded).not.toContain(privateText);
  const fresh=await cache();const imported=fresh.trackerRestore(snapshot,digest);
  expect(imported).not.toBe(root.workId);
  const children=fresh.children(imported);expect(children.map(child=>child.kind).sort()).toEqual(['build','decision']);
  expect(fresh.list({}).every(record=>record.status==='List')).toBe(true);
  expect(fresh.body(imported,'map')).toContain('flowchart LR');
  const restoredBuild=children.find(child=>child.kind==='build')!;
  expect(fresh.body(restoredBuild.workId,'brief')).toBeNull();expect(fresh.children(restoredBuild.workId)).toEqual([]);
  expect(fresh.blockingDependencies(restoredBuild.workId)[0]).toMatchObject({need:'Relay contract',owner:'team/relay',ticket:'team/relay#6'});
  expect(records.read(build.workId).status).toBe('Queued');
});

test('ordinary tickets and status, brief, decision-answer and slice changes make no tracker writes',async()=>{
  const records=await cache();let ordinary=records.create({repository:'team/server',kind:'bug',title:'Fix playback',ticket:'team/server#9'});
  const fake=fakeProvider();await syncStructures(records,{provider:fake.provider,setups:[settings('team/server')]});expect(fake.writes).toEqual([]);
  ordinary=records.setBody(ordinary.workId,ordinary.revision,'brief','Private');ordinary=records.update(ordinary.workId,ordinary.revision,{status:'Queued'});
  await syncStructures(records,{provider:fake.provider,setups:[settings('team/server')]});expect(fake.writes).toEqual([]);
  const {root,build,decision}=await concept(records);fake.put('team/server',42);const setups=[settings('team/server'),settings('team/apple'),settings('team/relay')];
  await syncStructures(records,{provider:fake.provider,setups});fake.writes.length=0;
  records.update(build.workId,records.read(build.workId).revision,{status:'Shaping'});
  records.setBody(build.workId,records.read(build.workId).revision,'brief','A changed private brief');
  records.setBody(decision.workId,records.read(decision.workId).revision,'answer','Another private answer');
  await syncStructures(records,{provider:fake.provider,setups});expect(fake.writes).toEqual([]);expect(records.trackerState(root.workId)).toEqual({state:'saved'});
});

test('disabled saving and unverified issue access never silently write',async()=>{
  const records=await cache();const {root}=await concept(records);const fake=fakeProvider();fake.put('team/server',42);
  await syncStructures(records,{provider:fake.provider,setups:[settings('team/server',false),settings('team/apple')]});expect(fake.writes).toEqual([]);
  const setup=settings('team/server');setup.access['tag-ticket']='unverified';
  await syncStructures(records,{provider:fake.provider,setups:[setup,settings('team/apple'),settings('team/relay')]});expect(fake.writes).toEqual([]);
  expect(records.trackerState(root.workId)).toMatchObject({state:'error',message:expect.stringContaining('Access to tag-ticket is not checked yet')});
});

test('incomplete chunks never commit; corrupt chunks never import; remote changes preserve pending local structure',async()=>{
  const records=await cache();let root=records.create({repository:'team/server',title:'Concept',kind:'concept',ticket:'team/server#42'});
  const longMap=`## Destination\nThere.\n\n## Map\n${randomBytes(100_000).toString('base64')}`;
  root=records.setBody(root.workId,root.revision,'map',longMap);
  const fake=fakeProvider();fake.put('team/server',42);fake.failComment(2);
  const setups=[settings('team/server')];await syncStructures(records,{provider:fake.provider,setups});
  expect(readTrackerStructure((await fake.provider.read('team/server',42)).body)).toBeUndefined();expect(records.trackerState(root.workId)?.state).toBe('error');
  await syncStructures(records,{provider:fake.provider,setups,workId:root.workId});
  const saved=await fake.provider.read('team/server',42);const meta=readTrackerStructure(saved.body)!;expect(meta.snapshot!.chunks.length).toBeGreaterThan(1);
  const first=meta.snapshot!.chunks[0]!;const original=fake.comments.get(first.id)!;fake.comments.set(first.id,original.replace(/\n[A-Za-z0-9+/=]+\n/,'\nAAAA\n'));
  await expect(readStructureSnapshot(saved,meta,fake.provider,setups)).rejects.toThrow('chunk');fake.comments.set(first.id,original);
  // Another machine commits a different generation before this machine's changed map is saved.
  const changed={...meta,snapshot:{...meta.snapshot!,digest:'b'.repeat(64)}};const {writeTrackerStructure}=await import('@lar-factory/shared');
  fake.issues.set('team/server#42',{...saved,body:writeTrackerStructure(saved.body,changed),version:'99'});
  records.setBody(root.workId,records.read(root.workId).revision,'map','## Destination\nLocal pending map');const before=fake.writes.length;
  await syncStructures(records,{provider:fake.provider,setups,workId:root.workId});expect(fake.writes).toHaveLength(before);
  expect(records.trackerState(root.workId)).toMatchObject({state:'conflict'});expect(records.body(root.workId,'map')).toContain('Local pending map');
});

test('Azure creates and restores structural work through a local fake CLI, with revision guards and no state or git writes',async()=>{
  const records=await cache();const dir=handles.at(-1)!.dir;const state=join(dir,'azure.json');const fake=join(dir,'az.mjs');
  writeFileSync(state,JSON.stringify({items:{},comments:{},writes:[],next:40}));
  writeFileSync(fake,`#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2),stateFile=${JSON.stringify(state)},state=JSON.parse(readFileSync(stateFile,'utf8'));
const value=flag=>args[args.indexOf(flag)+1],resource=value('--resource'),method=value('--http-method');
const route=Object.fromEntries(args.slice(args.indexOf('--route-parameters')+1).filter(arg=>arg.includes('=')).map(arg=>{const i=arg.indexOf('=');return [arg.slice(0,i),arg.slice(i+1)];}));
const body=args.includes('--in-file')?JSON.parse(readFileSync(value('--in-file'),'utf8')):undefined;
const emit=value=>process.stdout.write(JSON.stringify(value));const save=()=>writeFileSync(stateFile,JSON.stringify(state));
if(args[0]==='rest'){
 const id=value('--url').match(/workitems\\/(\\d+)/)[1],patch=JSON.parse(readFileSync(value('--body').slice(1),'utf8')),item=state.items[id];
 if(value('--method')!=='patch'||patch[0].path!=='/rev'||patch[0].value!==item.rev)throw Error('Missing REST revision guard');
 state.writes.push({resource:'workitems/rest',method:'PATCH',body:patch});for(const op of patch.slice(1))item.fields[op.path.slice('/fields/'.length)]=op.value;item.rev++;save();emit(item);process.exit(0);
}
if(args[0]!=='devops'||args[1]!=='invoke'||!['work','wit'].includes(value('--area')))throw Error('Unexpected write transport');
if(method!=='GET')state.writes.push({resource,method,body});
if(resource==='backlogconfiguration')emit({requirementBacklog:{workItemTypes:[{name:'Issue'}]}});
else if(resource==='teamfieldvalues')emit({defaultValue:'Project\\\\Team'});
else if(resource==='wiql')emit({workItems:Object.values(state.items).filter(item=>item.fields['System.Description'].includes(body.query.match(/CONTAINS '([^']+)'/)[1])).map(item=>({id:item.id}))});
else if(resource==='workitemsbatch')emit({value:body.ids.map(id=>state.items[id]).filter(Boolean)});
else if(resource==='workitems'){
 if(route.id)throw Error('Ambiguous invoke workitems/id route is forbidden');
 if(method==='GET')throw Error('Existing workitems must use the batch resource');
 else if(method==='POST'){const id=++state.next;const item={id,rev:1,fields:{}};for(const op of body)item.fields[op.path.slice('/fields/'.length)]=op.value;state.items[id]=item;save();emit(item);}
 else if(method==='PATCH'){const item=state.items[route.id];if(body[0].path!=='/rev'||body[0].value!==item.rev)throw Error('Missing revision guard');for(const op of body.slice(1))item.fields[op.path.slice('/fields/'.length)]=op.value;item.rev++;save();emit(item);}
 else throw Error('Unexpected work item method');
}else if(resource==='comments'){
 if(method==='POST'){if(value('--api-version')!=='7.1-preview.4'||!args.includes('format=markdown'))throw Error('Comment format missing');const id=String(++state.next);state.comments[id]=body.text;save();emit({id});}
 else emit({id:route.commentId,text:state.comments[route.commentId]});
}else throw Error('Unexpected fake Azure resource '+resource);
save();
`,{mode:0o755});
  vi.stubEnv('AZ_PATH',fake);vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY','');
  let root=records.create({repository:'sample/Project/app',kind:'concept',title:'Cross platform playback'});
  root=records.setBody(root.workId,root.revision,'map',MAP);
  root=records.update(root.workId,root.revision,{status:'Shaping'});
  let build=records.create({repository:'sample/Project/app',kind:'build',title:'Playback implementation',status:'Queued'});
  build=records.setParent(build.workId,build.revision,root.workId);
  build=records.setBody(build.workId,build.revision,'brief','PRIVATE AZURE BRIEF');
  const slice=records.create({repository:'sample/Project/app',kind:'slice',title:'PRIVATE AZURE SLICE'});
  records.setParent(slice.workId,slice.revision,build.workId);
  const setup={...settings('sample/Project/app'),itemSource:{kind:'azure-board' as const,team:'Team'}};
  const provider=structureProvider();await syncStructures(records,{provider,setups:[setup]});
  expect(records.trackerState(root.workId)).toEqual({state:'saved'});
  const current=records.read(root.workId);expect(current.ticket).toMatch(/^sample\/Project\/app#\d+$/);
  const number=Number(current.ticket!.slice(current.ticket!.lastIndexOf('#')+1));
  const ticket=await provider.read('sample/Project/app',number);const metadata=readTrackerStructure(ticket.body)!;
  const recovered=await readStructureSnapshot(ticket,metadata,provider,[setup]);const fresh=await cache();
  const local=fresh.trackerRestore(recovered.snapshot,recovered.digest);expect(fresh.body(local,'map')).toContain('flowchart LR');expect(fresh.read(local).status).toBe('List');
  expect(records.read(root.workId).status).toBe('Shaping');expect(records.read(build.workId).status).toBe('Queued');
  expect(fresh.list({}).every(record=>record.status==='List')).toBe(true);
  for(const privateText of ['Shaping','Queued','PRIVATE AZURE BRIEF','PRIVATE AZURE SLICE','queueOrder','buildPhase'])expect(JSON.stringify(recovered.snapshot)).not.toContain(privateText);
  const restoredBuild=fresh.children(local).find(record=>record.kind==='build')!;
  expect(fresh.body(restoredBuild.workId,'brief')).toBeNull();expect(fresh.children(restoredBuild.workId)).toEqual([]);
  const {writes,items}=JSON.parse(readFileSync(state,'utf8'));expect(items[String(number)].fields['System.AreaPath']).toBe('Project\\Team');
  expect(writes.some((write:{method:string})=>write.method==='PATCH')).toBe(true);
  expect(JSON.stringify(writes)).not.toContain('System.State');expect(JSON.stringify(writes)).not.toContain('System.Tags');
});

test('independent cross-repository roots share one manifest and checkpoint, including edits from either root',async()=>{
  const records=await cache();let server=records.create({repository:'team/server',kind:'build',title:'Server change',ticket:'team/server#1'});
  const apple=records.create({repository:'team/apple',kind:'build',title:'Apple change',ticket:'team/apple#2'});
  server=records.addBlocker(server.workId,server.revision,apple.workId);
  const fake=fakeProvider();fake.put('team/server',1);fake.put('team/apple',2);const setups=[settings('team/server'),settings('team/apple'),settings('team/relay')];
  await syncStructures(records,{provider:fake.provider,setups});
  expect(records.trackerState(server.workId)).toEqual({state:'saved'});expect(records.trackerState(apple.workId)).toEqual({state:'saved'});
  const first=readTrackerStructure((await fake.provider.read('team/server',1)).body)!.snapshot!;
  const second=readTrackerStructure((await fake.provider.read('team/apple',2)).body)!.snapshot!;expect(second).toEqual(first);
  records.addDependency(server.workId,{need:'Server contract',owner:'team/relay'});
  await syncStructures(records,{provider:fake.provider,setups});expect(records.trackerState(apple.workId)).toEqual({state:'saved'});
  records.addDependency(apple.workId,{need:'Apple entitlement',owner:'team/platform'});
  await syncStructures(records,{provider:fake.provider,setups});expect(records.trackerState(server.workId)).toEqual({state:'saved'});
  for(const [repository,number] of [['team/server',1],['team/apple',2]] as const){
    const ticket=await fake.provider.read(repository,number);const data=await readStructureSnapshot(ticket,readTrackerStructure(ticket.body)!,fake.provider,setups);
    const fresh=await cache();const root=fresh.trackerRestore(data.snapshot,data.digest);expect(fresh.trackerSnapshot(root).dependencies).toHaveLength(2);expect(fresh.trackerSnapshot(root).nodes).toHaveLength(2);
  }
});

test('ordinary issues linked by a same-repository blocker remain local',async()=>{
  const records=await cache();const first=records.create({repository:'team/server',kind:'feature',title:'First',ticket:'team/server#1'});
  const second=records.create({repository:'team/server',kind:'bug',title:'Second',ticket:'team/server#2'});records.addBlocker(first.workId,first.revision,second.workId);
  const fake=fakeProvider();await syncStructures(records,{provider:fake.provider,setups:[settings('team/server')]});expect(fake.writes).toEqual([]);expect(records.trackerState(first.workId)).toBeUndefined();
});

test('detaching a concept part retires its old parent manifest and blocker splits retire both old memberships',async()=>{
  const records=await cache();let root=records.create({repository:'team/server',kind:'concept',title:'Parent',ticket:'team/server#1'});
  let child=records.create({repository:'team/server',kind:'build',title:'Part',ticket:'team/server#2'});child=records.setParent(child.workId,child.revision,root.workId);
  const fake=fakeProvider();fake.put('team/server',1,'Author root.');fake.put('team/server',2,'Author child.');const setups=[settings('team/server'),settings('team/apple'),settings('team/relay')];
  await syncStructures(records,{provider:fake.provider,setups});records.clearParent(child.workId,records.read(child.workId).revision);
  await syncStructures(records,{provider:fake.provider,setups});
  const detached=await fake.provider.read('team/server',2);expect(detached.body.startsWith('Author child.')).toBe(true);
  expect(readTrackerStructure(detached.body)).toMatchObject({kind:'build'});expect(readTrackerStructure(detached.body)?.parent).toBeUndefined();expect(readTrackerStructure(detached.body)?.snapshot).toBeUndefined();
  const parent=await fake.provider.read('team/server',1);const parentSnapshot=await readStructureSnapshot(parent,readTrackerStructure(parent.body)!,fake.provider,setups);expect(parentSnapshot.snapshot.nodes).toHaveLength(1);
  let apple=records.create({repository:'team/apple',kind:'build',title:'Apple',ticket:'team/apple#3'});fake.put('team/apple',3,'Author Apple.');
  child=records.addBlocker(child.workId,records.read(child.workId).revision,apple.workId);await syncStructures(records,{provider:fake.provider,setups});
  records.removeBlocker(child.workId,records.read(child.workId).revision,apple.workId);await syncStructures(records,{provider:fake.provider,setups});
  for(const [repo,number] of [['team/server',2],['team/apple',3]] as const){const ticket=await fake.provider.read(repo,number);const metadata=readTrackerStructure(ticket.body)!;expect(metadata.snapshot).toBeUndefined();expect(metadata.blockers).toBeUndefined();expect(metadata.parent).toBeUndefined();}
});

test('moving a part to another concept updates both parent manifests and fresh imports follow the new owner',async()=>{
  const records=await cache();const oldParent=records.create({repository:'team/server',kind:'concept',title:'Old',ticket:'team/server#1'});
  const newParent=records.create({repository:'team/server',kind:'concept',title:'New',ticket:'team/server#3'});
  let child=records.create({repository:'team/server',kind:'build',title:'Move me',ticket:'team/server#2'});child=records.setParent(child.workId,child.revision,oldParent.workId);
  const fake=fakeProvider();fake.put('team/server',1);fake.put('team/server',2);fake.put('team/server',3);const setups=[settings('team/server')];
  await syncStructures(records,{provider:fake.provider,setups});child=records.clearParent(child.workId,records.read(child.workId).revision);records.setParent(child.workId,child.revision,newParent.workId);
  await syncStructures(records,{provider:fake.provider,setups});
  const ticket=await fake.provider.read('team/server',2);const metadata=readTrackerStructure(ticket.body)!;expect(metadata.parent?.url).toBe('https://github.com/team/server/issues/3');
  const recovered=await readStructureSnapshot(ticket,metadata,fake.provider,setups);const fresh=await cache();const root=fresh.trackerRestore(recovered.snapshot,recovered.digest);
  expect(fresh.read(root).ticket).toBe('team/server#3');expect(fresh.children(root)[0]?.ticket).toBe('team/server#2');
  const old=await fake.provider.read('team/server',1);expect(readTrackerStructure(old.body)?.parts).toEqual([]);
});

test('GitHub structural commits append comments, preserve interleaved author edits, find older managed comments and reject forks',async()=>{
  const records=await cache();const dir=handles.at(-1)!.dir;const state=join(dir,'github.json');const fake=join(dir,'gh.mjs');
  writeFileSync(state,JSON.stringify({body:'Author original.',labels:[],comments:[],writes:[],next:100,interleave:true}));
  writeFileSync(fake,`#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
const args=process.argv.slice(2),stateFile=${JSON.stringify(state)},state=JSON.parse(readFileSync(stateFile,'utf8'));
const path=args.find(arg=>arg.startsWith('repos/')),method=args.includes('--method')?args[args.indexOf('--method')+1]:'GET';
const payload=args.includes('--input')?JSON.parse(readFileSync(0,'utf8')):undefined;
const emit=value=>process.stdout.write(JSON.stringify(value)),save=()=>writeFileSync(stateFile,JSON.stringify(state));
if(method!=='GET')state.writes.push({path,method,payload});
if(method==='PATCH')throw Error('Structural writes must never PATCH authored issue bodies');
if(path.endsWith('/labels/linked-work'))emit({name:'linked-work'});
else if(path.endsWith('/issues/1/labels')){state.labels=[{name:'linked-work'}];save();emit(state.labels);}
else if(path.includes('/issues/1/comments?')){
 const page=Number(new URL('https://fixture/'+path).searchParams.get('page')||1),value=state.comments.slice((page-1)*100,page*100);
 if(args.includes('-i'))process.stdout.write('HTTP/2.0 200 OK\\r\\nETag: "fixture-'+state.comments.length+'-'+page+'"\\r\\n\\r\\n');emit(value);
}else if(path.endsWith('/issues/1/comments')){
 if(state.interleave){state.body='Author edited between the structure read and append.';state.interleave=false;}
 const id=String(++state.next);state.comments.push({id,body:payload.body});save();emit({id});
}else if(path.endsWith('/issues/1'))emit({number:1,html_url:'https://github.com/team/server/issues/1',body:state.body,labels:state.labels,comments:state.comments.length,updated_at:String(state.comments.length)});
else throw Error('Unexpected fake GitHub call '+JSON.stringify(args));
save();
`,{mode:0o755});
  vi.stubEnv('GH_PATH',fake);const provider=structureProvider();const ticket=await provider.read('team/server',1);
  const {writeTrackerStructure}=await import('@lar-factory/shared');
  const base={version:1 as const,kind:'concept' as const,identity:'11111111-1111-4111-8111-111111111111',repository:'team/server'};
  await provider.replace(ticket,writeTrackerStructure(ticket.body,base));
  let fixture=JSON.parse(readFileSync(state,'utf8'));expect(fixture.body).toBe('Author edited between the structure read and append.');expect(fixture.writes.some((write:{method:string})=>write.method==='PATCH')).toBe(false);
  // More than a page of ordinary discussion must not hide the latest saved structural projection.
  fixture.comments.push(...Array.from({length:120},(_,index)=>({id:String(500+index),body:`Ordinary comment ${index}`})));writeFileSync(state,JSON.stringify(fixture));
  const found=await provider.read('team/server',1);expect(readTrackerStructure(found.body)).toMatchObject(base);
  const manifest={root:'https://github.com/team/server/issues/1',repository:'team/server',generation:'22222222-2222-4222-8222-222222222222',digest:'a'.repeat(64),previous:null,chunks:[{id:'4',digest:'d'.repeat(64)}]};
  fixture=JSON.parse(readFileSync(state,'utf8'));fixture.comments.push({id:'800',body:writeTrackerStructure('',{...base,snapshot:manifest}).trim()});
  fixture.comments.push({id:'801',body:writeTrackerStructure('',{...base,snapshot:{...manifest,digest:'b'.repeat(64)}}).trim()});writeFileSync(state,JSON.stringify(fixture));
  await expect(provider.read('team/server',1)).rejects.toThrow('concurrent tracker versions');
});

test('a dependency owner issue is a reverse-linked durable member and can recover its concept after reset',async()=>{
  const records=await cache();const root=records.create({repository:'team/server',kind:'concept',title:'Playback',ticket:'team/server#1'});
  let build=records.create({repository:'team/server',kind:'build',title:'Player',ticket:'team/server#2'});build=records.setParent(build.workId,build.revision,root.workId);
  const dependency=records.addDependency(root.workId,{need:'Relay endpoint',owner:'team/relay',ticket:'team/relay#6'});records.addDependencyBlock(dependency.dependencyId,dependency.revision,build.workId);
  const fake=fakeProvider();fake.put('team/server',1);fake.put('team/server',2);const setups=[settings('team/server'),settings('team/relay')];
  const nativeRead=fake.provider.read;fake.provider.read=async(repo,number)=>({...await nativeRead(repo,number),...(repo==='team/relay'?{title:'Relay author title',kind:'bug' as const}:{})});
  await syncStructures(records,{provider:fake.provider,setups});expect(records.trackerState(root.workId)).toEqual({state:'saved'});
  const relay=await fake.provider.read('team/relay',6);const metadata=readTrackerStructure(relay.body)!;
  expect(metadata.kind).toBe('bug');expect(metadata.connections?.some(connection=>connection.url==='https://github.com/team/server/issues/1')).toBe(true);
  const saved=await readStructureSnapshot(relay,metadata,fake.provider,setups);expect(saved.snapshot.nodes.find(node=>node.ticket==='team/relay#6')).toMatchObject({repository:'team/relay',kind:'bug',title:'Relay author title'});
  const fresh=await cache();const restored=fresh.trackerRestore(saved.snapshot,saved.digest);
  expect(fresh.read(restored).ticket).toBe('team/server#1');expect(fresh.dependencies(restored)[0]?.ticket).toBe('team/relay#6');
  const owner=fresh.list({repository:'team/relay'})[0]!;expect(owner.title).toBe('Relay author title');expect(owner.status).toBe('List');expect(fresh.trackerSnapshot(owner.workId).root).toBe(saved.snapshot.root);
  expect(fake.writes).toContain('replace team/relay#6');
});

test('an unonboarded dependency repository blocks the whole structural save before any provider write',async()=>{
  const records=await cache();const root=records.create({repository:'team/server',kind:'concept',title:'Playback',ticket:'team/server#1'});
  records.addDependency(root.workId,{need:'Relay endpoint',owner:'team/relay',ticket:'team/relay#6'});const fake=fakeProvider();fake.put('team/server',1);
  await syncStructures(records,{provider:fake.provider,setups:[settings('team/server')]});expect(fake.writes).toEqual([]);
  expect(records.trackerState(root.workId)).toMatchObject({state:'error',message:expect.stringContaining('Add team/relay')});
});

test('Azure dependency PR references retain their repository URL and round trip separately from work items',async()=>{
  const records=await cache();const root=records.create({repository:'org/Project/server',kind:'concept',title:'Playback',ticket:'org/Project/server#1'});
  records.addDependency(root.workId,{need:'Relay endpoint',owner:'org/Project/relay',ticket:'org/Project/relay#6',pullRequests:['org/Project/relay#7']});
  const snapshot=records.trackerSnapshot(root.workId);expect(snapshot.dependencies[0]?.ticket).toBe('https://dev.azure.com/org/Project/_workitems/edit/6');
  expect(snapshot.dependencies[0]?.pullRequests).toEqual(['https://dev.azure.com/org/Project/_git/relay/pullrequest/7']);
  const fresh=await cache();const restored=fresh.trackerRestore(snapshot,'a'.repeat(64));expect(fresh.dependencies(restored)[0]?.pullRequests).toEqual(['org/Project/relay#7']);
});

test('untrusted snapshot shape and repository mismatches fail before any context reads or import writes',async()=>{
  const {gzipSync}=await import('node:zlib');const {createHash}=await import('node:crypto');const {writeTrackerStructure}=await import('@lar-factory/shared');
  const digest=(text:string)=>createHash('sha256').update(text).digest('hex');const identity='11111111-1111-4111-8111-111111111111';const generation='22222222-2222-4222-8222-222222222222';
  const valid={version:1,root:identity,nodes:[{key:identity,repository:'team/server',ticket:'team/server#1',kind:'concept',title:'Concept',parent:null,blockers:[]}],dependencies:[]};
  for(const payload of [{...valid,nodes:[null]}, {...valid,nodes:[{...valid.nodes[0],ticket:'unrelated/secret#1'}]}, {...valid,nodes:Array.from({length:1001},()=>valid.nodes[0])}, {...valid,nodes:[{...valid.nodes[0],brief:'PRIVATE ORDINARY BRIEF'}]}]){
    const raw=JSON.stringify(payload);const encoded=gzipSync(raw).toString('base64');let contextReads=0;
    const metadata={version:1 as const,kind:'concept' as const,snapshot:{root:'https://github.com/team/server/issues/1',repository:'team/server',generation,digest:digest(raw),chunks:[{id:'5',digest:digest(encoded)}]}};
    const ticket={repository:'team/server',number:1,version:'1',body:writeTrackerStructure('',metadata)};
    const provider={read:async()=>{contextReads++;throw Error('Unexpected authenticated context read');},readComment:async()=>`<!-- lar-factory:chunk ${generation} 0\n${encoded}\n-->`} as unknown as StructureProvider;
    const fresh=await cache();await expect(readStructureSnapshot(ticket,metadata,provider,[settings('team/server')]).then(saved=>{
      return Promise.all(saved.snapshot.nodes.map(node=>provider.read(node.repository,1))).then(()=>fresh.trackerRestore(saved.snapshot,saved.digest));
    })).rejects.toThrow();expect(contextReads).toBe(0);expect(fresh.list({})).toEqual([]);
  }
});

test('removing a dependency ticket after recovery retires that owner issue reverse projection',async()=>{
  const records=await cache();const root=records.create({repository:'team/server',kind:'concept',title:'Playback',ticket:'team/server#1'});
  records.addDependency(root.workId,{need:'Relay endpoint',owner:'team/relay',ticket:'team/relay#6'});const fake=fakeProvider();fake.put('team/server',1);const setups=[settings('team/server'),settings('team/relay')];
  await syncStructures(records,{provider:fake.provider,setups});const owner=await fake.provider.read('team/relay',6);const saved=await readStructureSnapshot(owner,readTrackerStructure(owner.body)!,fake.provider,setups);
  const fresh=await cache();const imported=fresh.trackerRestore(saved.snapshot,saved.digest);const dependency=fresh.dependencies(imported)[0]!;
  fresh.updateDependency(dependency.dependencyId,dependency.revision,{ticket:null});await syncStructures(fresh,{provider:fake.provider,setups});
  const retired=readTrackerStructure((await fake.provider.read('team/relay',6)).body)!;expect(retired.snapshot).toBeUndefined();expect(retired.connections).toBeUndefined();
  expect(fresh.trackerState(imported)).toEqual({state:'saved'});
});

function deferred() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}
async function sharedCache(records:WorkRecords) {
  const second=await openWorkRecords(records.trackerDatabasePath());
  return second;
}
test('two handles to one database drain a busy caller latest map without a board timer or duplicate manifest',async()=>{
  const records=await cache();const second=await sharedCache(records);
  try {
    let root=records.create({repository:'team/server',kind:'concept',title:'Concept',ticket:'team/server#42'});
    root=records.setBody(root.workId,root.revision,'map','## Destination\nInitial map');
    const fake=fakeProvider();fake.put('team/server',42);const entered=deferred(),resume=deferred();let paused=false;
    const provider:StructureProvider={...fake.provider,read:async(repo,num)=>{
      if(!paused){paused=true;entered.resolve();await resume.promise;}
      return fake.provider.read(repo,num);
    }};
    const options={provider,setups:[settings('team/server')]};
    const first=syncStructures(records,options);await entered.promise;
    second.setBody(root.workId,second.read(root.workId).revision,'map','## Destination\nLatest map');
    await syncStructures(second,options); // The live lease returns immediately with durable work pending.
    expect(second.trackerState(root.workId)).toEqual({state:'pending'});
    expect(fake.writes).toEqual([]);
    resume.resolve();await first;
    expect(fake.writes.filter(write=>write==='replace team/server#42')).toHaveLength(1);
    expect(fake.writes.filter(write=>write==='comment')).toHaveLength(1);
    const ticket=await fake.provider.read('team/server',42);
    const saved=await readStructureSnapshot(ticket,readTrackerStructure(ticket.body)!,fake.provider,options.setups);
    expect(saved.snapshot.nodes[0]!.map).toContain('Latest map');
    expect(records.trackerPending()).toEqual([]);
    expect(second.trackerState(root.workId)).toEqual({state:'saved'});
  } finally {second.close();}
});

test('a failed stale attempt does not mark newer work failed and an explicit owner also drains other components',async()=>{
  const records=await cache();const second=await sharedCache(records);
  try {
    const root=records.create({repository:'team/server',kind:'concept',title:'First',ticket:'team/server#42'});
    let other=records.create({repository:'team/apple',kind:'concept',title:'Other',ticket:'team/apple#7'});
    other=records.setBody(other.workId,other.revision,'map','## Destination\nOther initial');
    const fake=fakeProvider();fake.put('team/server',42);fake.put('team/apple',7);
    const entered=deferred(),resume=deferred();let paused=false;
    const provider:StructureProvider={...fake.provider,read:async(repo,num)=>{
      if(!paused){paused=true;entered.resolve();await resume.promise;throw Error('Obsolete read failed.');}
      return fake.provider.read(repo,num);
    }};
    const options={provider,setups:[settings('team/server'),settings('team/apple')]};
    const first=syncStructures(records,{...options,workId:root.workId});await entered.promise;
    second.setBody(root.workId,second.read(root.workId).revision,'map','## Destination\nFirst latest');
    second.setBody(other.workId,second.read(other.workId).revision,'map','## Destination\nOther latest');
    await syncStructures(second,{...options,workId:other.workId});resume.resolve();await first;
    expect(records.trackerPending()).toEqual([]);
    for(const id of [root.workId,other.workId])expect(second.trackerState(id)).toEqual({state:'saved'});
    expect(fake.writes.filter(write=>write.startsWith('replace '))).toHaveLength(2);
    const ticket=await fake.provider.read('team/apple',7);
    expect((await readStructureSnapshot(ticket,readTrackerStructure(ticket.body)!,fake.provider,options.setups)).snapshot.nodes[0]!.map).toContain('Other latest');
  } finally {second.close();}
});

test('a local map change after root commit resumes from its own checkpoint without a false cross-machine conflict',async()=>{
  const records=await cache();const second=await sharedCache(records);
  try {
    const root=records.create({repository:'team/server',kind:'concept',title:'Concept',ticket:'team/server#42'});
    const fake=fakeProvider();fake.put('team/server',42);const entered=deferred(),resume=deferred();let paused=false;
    const provider:StructureProvider={...fake.provider,replace:async(ticket,body)=>{
      await fake.provider.replace(ticket,body);
      if(!paused){paused=true;entered.resolve();await resume.promise;}
    }};
    const options={provider,setups:[settings('team/server')]};const first=syncStructures(records,options);await entered.promise;
    second.setBody(root.workId,second.read(root.workId).revision,'map','## Destination\nAfter commit');
    await syncStructures(second,options);resume.resolve();await first;
    expect(second.trackerState(root.workId)).toEqual({state:'saved'});expect(records.trackerPending()).toEqual([]);
    const ticket=await fake.provider.read('team/server',42);
    const saved=await readStructureSnapshot(ticket,readTrackerStructure(ticket.body)!,fake.provider,options.setups);
    expect(saved.snapshot.nodes[0]!.map).toContain('After commit');
    // Each digest was committed once. The second commit is the actual later edit, not a duplicate.
    expect(fake.writes.filter(write=>write==='replace team/server#42')).toHaveLength(2);
  } finally {second.close();}
});

test('an unchanged failure stays pending without an immediate drain retry loop',async()=>{
  const records=await cache();const root=records.create({repository:'team/server',kind:'concept',title:'Concept',ticket:'team/server#42'});
  const fake=fakeProvider();let attempts=0;
  const provider:StructureProvider={...fake.provider,read:async()=>{attempts++;throw Error('Service unavailable.');}};
  await syncStructures(records,{provider,setups:[settings('team/server')],workId:root.workId});
  expect(attempts).toBe(1);expect(records.trackerPending()).toHaveLength(1);
  expect(records.trackerState(root.workId)).toEqual({state:'error',message:'Service unavailable.'});
});


test('a stale failure checkpoint cannot overwrite a later structural outbox entry',async()=>{
  const records=await cache();const root=records.create({repository:'team/server',kind:'concept',title:'Concept',ticket:'team/server#42'});
  const digest=trackerDigest(records.trackerSnapshot(root.workId));
  records.setBody(root.workId,root.revision,'map','## Destination\nLater map');
  records.trackerFailed(root.workId,'An obsolete request failed.',true,digest);
  expect(records.trackerState(root.workId)).toEqual({state:'pending'});
  expect(records.trackerCheckpoint(root.workId).error).toBeNull();
});
