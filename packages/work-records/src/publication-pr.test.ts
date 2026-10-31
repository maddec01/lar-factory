import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { effectiveVocabulary, type PublicationPlan } from '@lar-factory/shared';
import type { PublicationSettings } from '@lar-factory/shared/publication-settings';
import { openWorkRecords } from './work-records.ts';
import { publicationPr } from './publication-pr.ts';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach((close) => close()));
async function fixture(provider: 'github' | 'azure', ticketless = false) {
  const dir = mkdtempSync(join(tmpdir(), 'publication-pr-')); cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const records = await openWorkRecords(join(dir, 'records.db')); cleanup.push(() => records.close());
  const repository = provider === 'github' ? 'team/app' : 'contoso/project/app';
  let work = records.create({ title: 'Search', repository, kind: 'build', ...(ticketless ? {} : { ticket: `${repository}#12` }) });
  work = records.setBody(work.workId, work.revision, 'brief', 'Private brief.');
  records.recordGate(work.workId, work.revision, { briefDigest: records.gate(work.workId).briefDigest!, approvedBy: 'reviewer', evidence: 'Passed.' });
  work = records.setPullRequest(work.workId, work.revision, `${repository}#5`);
  const config: PublicationSettings = { snapshot: 'settings', discovery: { provider, types: { state: 'available', choices: [] }, labels: { state: 'available', choices: [] } },
    setup: { repo: repository, role: '', itemSource: provider === 'github' ? { kind: 'issues' } : { kind: 'azure-board', team: 'Team' }, labels: [], domainDocs: { kind: 'private' }, skills: [],
      ...effectiveVocabulary(), access: {} as PublicationSettings['setup']['access'], consent: ['relate-ticket'], paused: [], sources: {} as PublicationSettings['setup']['sources'], shared: {} } };
  const state = { body: '## Outcome\n\nFind saved searches.\n\nUse prefixes because names are stable.', linked: false, lost: false, refused: false, readRefused: false, transitionWorkItems: false };
  const calls: string[][] = [];
  const pr = publicationPr(records, { settings: async () => config, transport: {
    github: async (args) => { calls.push(args); return JSON.stringify({ body: state.body, base: { repo: { default_branch: 'main' }, ref: 'main' } }); },
    azure: async (args) => {
      calls.push(args);
      if (args.includes('show')) return JSON.stringify({ pullRequestId: 5, repository: { name: 'app', project: { name: 'project' } }, completionOptions: { transitionWorkItems: state.transitionWorkItems } });
      if (args.includes('list')) { if (state.readRefused) throw new Error('HTTP 403 read refused'); return JSON.stringify(state.linked ? [{ id: '12' }] : []); }
      if (args.includes('add')) {
        if (state.refused) throw new Error('HTTP 403 link refused');
        state.linked = true;
        if (state.lost) throw new Error('Lost response');
        return '[]';
      }
      throw new Error('Unexpected controlled call');
    },
  } });
  const approve = (plan: PublicationPlan) => records.approvePublication(work.workId, plan.planId, plan.revision, plan.digest, 'person');
  return { records, work, pr, state, calls, approve, config };
}

it('adds a GitHub closing reference while keeping a complete PR body and records its verified delivery', async () => {
  const f = await fixture('github');
  const body = f.pr.body(f.work.workId, f.state.body);
  expect(body.body).toBe('## Outcome\n\nFind saved searches.\n\nUse prefixes because names are stable.\n\nCloses team/app#12\n');
  f.state.body = body.body;
  const plan = await f.pr.prepare(f.work.workId);
  expect(plan!.operations[0]).toMatchObject({ kind: 'pr-closing-reference', pullRequest: 'team/app#5', content: body.body });
  f.approve(plan!);
  expect(await f.pr.execute(f.work.workId, plan!.planId, 'approver')).toMatchObject({ uncertain: [], successful: [expect.any(String)] });
  expect(f.calls.every((args) => !args.includes('PATCH'))).toBe(true);
});

it.each([false, true])('links Azure work items without changing native completion behavior %s', async (transitionWorkItems) => {
  const f = await fixture('azure'); f.state.transitionWorkItems = transitionWorkItems;
  const plan = await f.pr.prepare(f.work.workId); f.approve(plan!);
  expect(await f.pr.execute(f.work.workId, plan!.planId, 'approver')).toMatchObject({ failed: [], uncertain: [], successful: [expect.any(String)] });
  expect(f.calls.filter((args) => args.includes('add'))).toEqual([['repos', 'pr', 'work-item', 'add', '--id', '5', '--work-items', '12', '--org', 'https://dev.azure.com/contoso', '--detect', 'false', '--output', 'json']]);
  expect(f.calls.flat().join(' ')).not.toMatch(/transition-work-items|State|update|--auto-complete/);
  expect(f.state.transitionWorkItems).toBe(transitionWorkItems);
});

it('records Azure refusal and requires a replacement approval before retrying', async () => {
  const f = await fixture('azure'); f.state.refused = true;
  const plan = await f.pr.prepare(f.work.workId); f.approve(plan!);
  expect((await f.pr.execute(f.work.workId, plan!.planId, 'approver')).failed).toHaveLength(1);
  f.state.refused = false;
  await f.pr.execute(f.work.workId, plan!.planId, 'approver');
  expect(f.calls.filter((args) => args.includes('add'))).toHaveLength(1);
  const replacement = await f.pr.prepare(f.work.workId);
  expect((await f.pr.execute(f.work.workId, replacement!.planId, 'approver')).current).toBe(false);
  f.approve(replacement!);
  expect((await f.pr.execute(f.work.workId, replacement!.planId, 'approver')).successful).toHaveLength(1);
});

it('reconciles a lost Azure response and never duplicates the recorded relationship', async () => {
  const f = await fixture('azure'); f.state.lost = true;
  const plan = await f.pr.prepare(f.work.workId); f.approve(plan!);
  expect((await f.pr.execute(f.work.workId, plan!.planId, 'approver')).uncertain).toHaveLength(1);
  await f.pr.execute(f.work.workId, plan!.planId, 'approver');
  await expect(f.pr.prepare(f.work.workId)).rejects.toThrow(/uncertain/i);
  expect((await f.pr.reconcile(f.work.workId, plan!.planId, 'person')).successful).toHaveLength(1);
  await f.pr.execute(f.work.workId, plan!.planId, 'approver');
  expect(f.calls.filter((args) => args.includes('add'))).toHaveLength(1);
  expect(f.records.completion(f.work.workId).complete).toBe(false);
  f.records.observe(f.work.workId, f.records.read(f.work.workId).revision, { of: 'pr', state: 'merged' });
  expect(f.records.completion(f.work.workId).complete).toBe(true);
});

it('retains complete ticketless outcome and reasons without inheriting a concept parent ticket', async () => {
  const f = await fixture('github', true);
  const concept = f.records.create({ title: 'Parent', repository: 'team/app', kind: 'concept', ticket: 'team/app#99' });
  f.records.setParent(f.work.workId, f.records.read(f.work.workId).revision, concept.workId);
  expect(f.pr.body(f.work.workId, f.state.body)).toEqual({ body: f.state.body, ticket: null, closingReference: null });
  expect(await f.pr.prepare(f.work.workId)).toBeNull();
  expect(f.calls).toEqual([]);
});

it('keeps uncertainty when link inspection is refused and requires explicit resolution when absent', async () => {
  const f = await fixture('azure'); f.state.lost = true;
  const plan = await f.pr.prepare(f.work.workId); f.approve(plan!);
  await f.pr.execute(f.work.workId, plan!.planId, 'approver');
  f.state.readRefused = true;
  expect((await f.pr.reconcile(f.work.workId, plan!.planId, 'person')).uncertain).toHaveLength(1);
  f.state.readRefused = false; f.state.linked = false;
  expect((await f.pr.reconcile(f.work.workId, plan!.planId, 'person')).uncertain).toHaveLength(1);
  await f.pr.execute(f.work.workId, plan!.planId, 'approver');
  expect(f.calls.filter((args) => args.includes('add'))).toHaveLength(1);
});

it('blocks a changed GitHub PR body or publication settings until a new exact approval', async () => {
  const f = await fixture('github'); f.state.body = f.pr.body(f.work.workId, f.state.body).body;
  const plan = await f.pr.prepare(f.work.workId); f.approve(plan!);
  f.state.body += '\nA teammate added another outcome.';
  expect(await f.pr.execute(f.work.workId, plan!.planId, 'approver')).toMatchObject({ current: false, successful: [] });
  const next = await f.pr.prepare(f.work.workId); f.approve(next!);
  f.config.snapshot = 'changed';
  expect(await f.pr.execute(f.work.workId, next!.planId, 'approver')).toMatchObject({ current: false, successful: [] });
});

it('requires Azure relationship consent and never treats a closed ticket as local completion', async () => {
  const f = await fixture('azure'); f.config.setup.consent = [];
  await expect(f.pr.prepare(f.work.workId)).rejects.toThrow(/consent/);
  f.records.observe(f.work.workId, f.records.read(f.work.workId).revision, { of: 'ticket', state: 'closed' });
  expect(f.records.completion(f.work.workId).complete).toBe(false);
});

it('finds this build receipt in a concept-owned publication without closing the parent', async () => {
  const f = await fixture('github', true);
  let concept = f.records.create({ title: 'Saved searches', repository: 'team/app', kind: 'concept' });
  f.records.setParent(f.work.workId, f.records.read(f.work.workId).revision, concept.workId);
  concept = f.records.setBody(concept.workId, f.records.read(concept.workId).revision, 'map', 'Settled destination.');
  concept = f.records.setFogGone(concept.workId, concept.revision, true);
  let plan = f.records.proposePublication(concept.workId, concept.revision, {
    sources: f.records.publicationReadiness(concept.workId).sources.map(({ workId, revision }) => ({ workId, revision })),
    tickets: [concept, f.work].map(({ workId }) => ({ workId, destination: { provider: 'github', repository: 'team/app' }, vocabulary: {}, typeResolution: { candidates: [], selected: null }, title: 'Find saved searches', body: 'Find saved searches by name.' })),
    operations: [concept, f.work].map(({ workId }, index) => ({ operationId: `create-${index}`, kind: 'create', ticketWorkId: workId, dependsOn: [] })),
  });
  plan = f.records.approvePublication(concept.workId, plan.planId, plan.revision, plan.digest, 'person');
  for (const [index, operation] of plan.operations.entries()) {
    const claim = f.records.claimPublication(concept.workId, plan.planId, plan.revision, plan.digest, { tickets: plan.tickets, operations: plan.operations }, 'executor');
    plan = f.records.recordPublicationOutcome(concept.workId, plan.planId, claim.plan.revision, operation.operationId, claim.claimToken, {
      status: 'successful', evidence: 'Controlled creation receipt.', ticket: `team/app#${index + 21}`, url: `https://github.com/team/app/issues/${index + 21}`, location: { kind: 'body', start: 0, end: 'Find saved searches by name.'.length },
    });
  }
  expect(f.records.read(f.work.workId).ticket).toBeNull();
  f.state.body = f.pr.body(f.work.workId, f.state.body).body;
  expect(f.state.body).toContain('Closes team/app#22');
  expect(f.state.body).not.toContain('team/app#21');
  expect((await f.pr.prepare(f.work.workId))!.tickets[0]!.destination.ticket).toBe('team/app#22');
});
