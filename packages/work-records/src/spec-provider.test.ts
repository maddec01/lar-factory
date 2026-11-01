import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { structureProvider } from './tracker-sync.ts';

const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fake(command: 'gh' | 'az', initial: object) {
  const dir = mkdtempSync(join(tmpdir(), 'spec-provider-')); dirs.push(dir);
  const state = join(dir, 'state.json'); writeFileSync(state, JSON.stringify(initial));
  const file = join(dir, command);
  const calls = join(dir, 'calls.jsonl'); writeFileSync(calls, '');
  writeFileSync(file, `#!${process.execPath}
import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
const path=${JSON.stringify(state)};const state=JSON.parse(readFileSync(path,'utf8'));const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
let result;
if(${JSON.stringify(command)}==='gh'){
  const body=args.includes('--input') ? JSON.parse(readFileSync(0,'utf8')) : null;
  if(args[1]==='graphql')result={data:{repository:{issue:{body:state.historyBody ?? state.body,title:state.historyTitle ?? state.title,editor:{login:state.editor},timelineItems:{nodes:[{actor:{login:state.titleEditor}}]}}}}};
  else if(args[1].includes('/collaborators/'))result={permission:state.permission};
  else if(args.includes('PATCH')){state.body=body.body;state.updated_at='2';result=state;}
  else result=state;
}else{
  if(args[0]==='rest'){
    const patch=JSON.parse(readFileSync(args[args.indexOf('--body')+1].slice(1),'utf8'));state.patch=patch;
    if(patch[0].value!==state.rev)process.exit(1);
    for(const op of patch.slice(1))state.fields[op.path.slice('/fields/'.length)]=op.value;
    state.rev++;result=state;
  }else result={value:[state]};
}
writeFileSync(path,JSON.stringify(state));process.stdout.write(JSON.stringify(result));
`);
  chmodSync(file, 0o755); vi.stubEnv(command === 'gh' ? 'GH_PATH' : 'AZ_PATH', file);
  return { calls: () => readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]), read: () => JSON.parse(readFileSync(state, 'utf8')), change: (value: object) => writeFileSync(state, JSON.stringify(value)) };
}

test('GitHub reads body and title editor permissions, and a Spec write patches the issue body itself', async () => {
  const f = fake('gh', { number: 7, body: 'Authored.', title: 'Work', updated_at: '1', editor: 'member', titleEditor: 'member', permission: 'write' });
  const provider = structureProvider();
  const ticket = await provider.readSpec!('example/widget', 7);
  expect(ticket).toMatchObject({ body: 'Authored.', editorWrite: true, titleEditorWrite: true });
  await provider.replaceSpec!(ticket, 'Gated Spec.');
  expect(f.read().body).toBe('Gated Spec.');
  f.change({ ...f.read(), permission: 'read' });
  expect(await provider.readSpec!('example/widget', 7)).toMatchObject({ editorWrite: false, titleEditorWrite: false });
});

test('GitHub rereads just before PATCH and refuses a concurrent title or body change', async () => {
  const f = fake('gh', { number: 7, body: 'Authored.', title: 'Work', updated_at: '1', permission: 'write' });
  const provider = structureProvider(); const ticket = await provider.readSpec!('example/widget', 7);
  f.change({ ...f.read(), body: 'Concurrent edit.' });
  await expect(provider.replaceSpec!(ticket, 'Gated Spec.')).rejects.toThrow('changed before');
  expect(f.read().body).toBe('Concurrent edit.');
});

test('Azure Bug Spec writes test the revision and patch Repro Steps while leaving Description metadata intact', async () => {
  const f = fake('az', { id: 7, rev: 12, fields: { 'System.Title': 'Bug', 'System.WorkItemType': 'Bug', 'System.Description': 'Managed structure and other text.', 'Microsoft.VSTS.TCM.ReproSteps': '<p>Reproduce.</p>' } });
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '0');
  const provider = structureProvider(); const ticket = await provider.readSpec!('example/Project/widget', 7);
  expect(ticket).toMatchObject({ body: '<p>Reproduce.</p>', bodyField: 'Microsoft.VSTS.TCM.ReproSteps', version: '12' });
  const written = await provider.replaceSpec!(ticket, '<h2>Spec</h2>');
  expect(written).toMatchObject({ body: '<h2>Spec</h2>', version: '13' });
  expect(f.read().patch).toEqual([{ op: 'test', path: '/rev', value: 12 }, { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: '<h2>Spec</h2>' }]);
  expect(f.read().fields['System.Description']).toBe('Managed structure and other text.');
});


test('unchanged GitHub bytes skip provenance reads and one editor needs one permission read', async () => {
  const f = fake('gh', { number: 7, body: 'Authored.', title: 'Work', updated_at: '1', editor: 'member', titleEditor: 'member', permission: 'write' });
  const provider = structureProvider();
  const first = await provider.readSpec!('example/widget', 7);
  await provider.readSpec!('example/widget', 7, first);
  expect(f.calls().filter(args => args[1] === 'graphql')).toHaveLength(1);
  expect(f.calls().filter(args => args[1]?.includes('/collaborators/'))).toHaveLength(1);
  expect(f.calls()).toHaveLength(4);
  f.change({ ...f.read(), body: 'Changed bytes.', permission: 'read' });
  expect(await provider.readSpec!('example/widget', 7, first)).toMatchObject({ body: 'Changed bytes.', editorWrite: false, titleEditorWrite: false });
});

test.each([{ historyBody: 'Racing body.' }, { historyTitle: 'Racing title' }])('provenance never attests to mismatched history %j', async history => {
  fake('gh', { number: 7, body: 'New bytes.', title: 'Work', updated_at: '1', editor: 'member', titleEditor: 'member', permission: 'write', ...history });
  const read = await structureProvider().readSpec!('example/widget', 7, { body: 'Old bytes.', title: 'Work' });
  expect(read.editorWrite).toBeUndefined();
  expect(read.titleEditorWrite).toBeUndefined();
});
