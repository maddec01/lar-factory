import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vite-plus/test';
import { writeListFile, setConsent } from '@lar-factory/shared/repository-settings';
import { openWorkRecords, workRecordsPath } from './work-records.ts';

it('prepares, inspects, approves, executes, reconciles and resumes with the board closed and a controlled gh process', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'publication cli '));
  const records = await openWorkRecords(workRecordsPath(dir));
  try {
    const fake = join(dir, 'gh.mjs'); const state = join(dir, 'provider.json'); const writes = join(dir, 'writes.jsonl'); const file = join(dir, 'input.json');
    writeFileSync(fake, `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const args = process.argv.slice(2); const path = args.find((a) => a.startsWith('repos/'));
const emit = (value) => process.stdout.write(JSON.stringify(value));
if (path?.endsWith('/contents/.lar-factory.json')) emit({vocabulary:{build:{type:'Task',labels:['Search']}}});
else if (path?.endsWith('/issue-types')) emit([[{name:'Task'}]]);
else if (path?.includes('/labels')) emit([[{name:'Search'}]]);
else if (args.includes('POST') && path?.endsWith('/issues')) {
 const body=JSON.parse(readFileSync(0,'utf8')); const item={...body,type:{name:body.type},labels:body.labels.map(name=>({name})),number:12,html_url:'https://github.com/team/app/issues/12'};
 writeFileSync(${JSON.stringify(state)},JSON.stringify(item)); appendFileSync(${JSON.stringify(writes)},JSON.stringify(body)+'\\n');
 process.stderr.write('Fixture lost the creation response.'); process.exitCode=1;
} else if (path?.includes('/issues?')) emit([[JSON.parse(readFileSync(${JSON.stringify(state)},'utf8'))]]);
else if (path?.endsWith('/issues/12')) emit(JSON.parse(readFileSync(${JSON.stringify(state)},'utf8')));
else if (path==='repos/team/app') emit([{owner:{type:'Organization'}}]);
else { process.stderr.write('Unexpected controlled call: '+args.join(' ')); process.exitCode=1; }
`, { mode: 0o755 });
    writeListFile(dir, { repositories: [{ repo: 'team/app' }] }); setConsent('team/app', ['publish-ticket', 'type-ticket', 'tag-ticket'], dir);
    let work = records.create({ title: 'Search', repository: 'team/app', kind: 'build' }); work = records.setBody(work.workId, work.revision, 'brief', 'Private brief.');
    records.recordGate(work.workId, work.revision, { briefDigest: records.gate(work.workId).briefDigest!, approvedBy: 'reviewer', evidence: 'Passed.' });
    const cli = async (...args: string[]) => {
      const { stdout } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, 'cli.ts'), ...args, '--data-dir', dir],
        { cwd: dir, env: { ...process.env, GH_PATH: fake, HOME: dir } });
      return JSON.parse(stdout);
    };
    writeFileSync(file, JSON.stringify({ documents: [{ workId: work.workId, title: 'Find searches', outcome: 'Find a saved search.', change: 'Filter by name.', checks: ['Matching results appear.'], assumptions: [], decisions: [], builderNotes: [], domainNotes: [], relatedTickets: [] }] }));
    const plan = await cli('prepare-publication', work.workId, '--file', file);
    const args = [work.workId, '--plan', plan.planId];
    expect(await cli('inspect-publication', ...args)).toMatchObject({ current: false, successful: [], uncertain: [] });
    const approved = await cli('approve-publication', ...args, '--revision', String(plan.revision), '--digest', plan.digest, '--identity', 'person');
    expect(approved.approval.digest).toBe(plan.digest);
    expect(await cli('execute-publication', ...args, '--identity', 'command')).toMatchObject({ uncertain: [`create:${work.workId}`] });
    expect(await cli('resume-publication', ...args, '--identity', 'command')).toMatchObject({ uncertain: [`create:${work.workId}`] });
    const reconciliation = await cli('reconcile-publication', ...args, '--identity', 'person');
    expect(reconciliation.candidates[0].tickets).toEqual([{ ticket: 'team/app#12', url: 'https://github.com/team/app/issues/12' }]);
    expect(reconciliation.uncertain).toHaveLength(1);
    writeFileSync(file, JSON.stringify([{ operationId: `create:${work.workId}`, ticket: 'team/app#12' }]));
    expect(await cli('reconcile-publication', ...args, '--identity', 'person', '--file', file)).toMatchObject({ successful: [`create:${work.workId}`], uncertain: [] });
    expect(await cli('resume-publication', ...args, '--identity', 'board')).toMatchObject({ successful: [`create:${work.workId}`], uncertain: [] });
    expect(readFileSync(writes, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(records.read(work.workId)).toMatchObject({ status: 'List', buildPhase: null });
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
});
