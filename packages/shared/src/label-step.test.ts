import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { STATUS_LABELS, customLabelChoices, customLabelProblem, customTagProblem, labelPlan, missingCustomLabels, labelsToCreate, workflowLabelsMissing } from './label-step.ts';
import { WORKFLOW_LABELS } from './workflow-labels.ts';

const ALL = WORKFLOW_LABELS.map((l) => l.name);
const states = (names: string[]) => Object.fromEntries(labelPlan(names, 'github-project').workflow.map((r) => [r.label.name, r.state]));

test('each workflow label is present, missing, or present under its old name with a Rename', () => {
  const plan = labelPlan(['bug', 'Feature', 'decision: grill', 'decision-task', 'decision: task'], 'github-project');
  assert.deepEqual(states(['bug', 'Feature', 'decision: grill', 'decision-task', 'decision: task']), {
    bug: 'present', feature: 'present', improvement: 'missing', concept: 'missing', 'decision-grill': 'rename', 'decision-prototype': 'missing',
    'decision-research': 'missing', 'decision-task': 'present', build: 'missing', active: 'missing', blocked: 'missing',
  });
  assert.deepEqual(plan.workflow.find((r) => r.label.name === 'decision-grill'), { label: WORKFLOW_LABELS[4], state: 'rename', oldName: 'decision: grill' });
});

test('an old name whose new one exists too is left alone with a note, as are labels lar-factory never made', () => {
  const plan = labelPlan(['decision-task', 'decision: task', 'needs-triage', 'ready-for-agent', 'status-list'], 'github-project');
  assert.deepEqual(plan.leftAlone, [{ name: 'decision: task', keptBeside: 'decision-task' }, { name: 'needs-triage' }, { name: 'ready-for-agent' }, { name: 'status-list' }]);
  assert.deepEqual(plan.status, [], 'a GitHub Project keeps no status labels');
});

test('a repository that reads its issues lists the status labels too, and those it has are not left alone', () => {
  const plan = labelPlan([...ALL, 'status-list', 'status-in-progress'], 'issues');
  assert.deepEqual(plan.status.map((r) => [r.label.name, r.state]), STATUS_LABELS.map((l) => [l.name, ['status-list', 'status-in-progress'].includes(l.name) ? 'present' : 'missing']));
  assert.deepEqual(plan.leftAlone, []);
  assert.deepEqual(STATUS_LABELS[0], { name: 'status-list', color: 'EDEDED', description: 'Status: List' });
});

test("an Azure DevOps team's sprint or backlog lists the status tags too, which a GitHub Project doesn't", () => {
  for (const source of ['azure-sprint', 'azure-backlog', 'azure-board'] as const) assert.equal(labelPlan(ALL, source).status.length, STATUS_LABELS.length);
  assert.deepEqual(labelPlan(ALL, 'github-project').status, []);
});

test('Next waits while any workflow label is missing or still under its old name, not for the status labels', () => {
  assert.equal(workflowLabelsMissing(labelPlan(ALL, 'issues')), false);
  assert.equal(workflowLabelsMissing(labelPlan(ALL.filter((n) => n !== 'blocked'), 'github-project')), true);
  assert.equal(workflowLabelsMissing(labelPlan([...ALL.filter((n) => n !== 'decision-grill'), 'decision: grill'], 'github-project')), true);
});

test('Create makes the missing labels, and those under an old name that Rename is not to move', () => {
  const plan = labelPlan(['bug', 'decision: grill', 'decision: task', 'status-list'], 'issues');
  const created = labelsToCreate(plan, ['decision: grill']).map((l) => l.name);
  assert.ok(created.includes('decision-task'));
  assert.ok(!created.includes('decision-grill'), 'Rename moves decision: grill');
  assert.ok(!created.includes('bug') && !created.includes('status-list'));
  assert.ok(created.includes('status-queued'));
});

test('the custom labels to pick from are the labels left alone, less the status labels and the old names kept beside their new ones', () => {
  const plan = labelPlan(['bug', 'decision-task', 'decision: task', 'decision: grill', 'app: music', 'Status-Queued', 'status-list', 'web'], 'github-project');
  assert.deepEqual(customLabelChoices(plan), ['app: music', 'web']);
});

test('the custom tags to pick from leave out the repo- tags that route Azure work items', () => {
  const plan = labelPlan(['repo-fabrikam-api', 'Repo-Fabrikam Web', 'web'], 'azure-sprint');
  assert.deepEqual(customLabelChoices(plan), ['web']);
});

test('a custom label may hold a colon, but is no workflow or status label and not empty', () => {
  assert.equal(customLabelProblem('app: music'), null);
  assert.match(customLabelProblem('  ')!, /name/);
  assert.match(customLabelProblem('Build')!, /reserved for tracking work/);
  assert.match(customLabelProblem('decision: grill')!, /reserved for tracking work/);
  assert.match(customLabelProblem('status-review')!, /reserved for board status/);
  assert.equal(customLabelProblem('x'.repeat(50)), null);
  assert.equal(customLabelProblem('x'.repeat(51)), 'Use at most 50 characters. This name has 51.');
  assert.equal(customLabelProblem(' -R'), 'Do not start the label name with a hyphen.');
});

test('a custom tag is refused as a custom label is, and also when it holds a comma or semicolon', () => {
  assert.equal(customTagProblem('app: music'), null);
  assert.match(customTagProblem('Build')!, /reserved for tracking work/);
  assert.equal(customTagProblem('app, music'), 'Use a tag name without commas or semicolons.');
  assert.equal(customTagProblem('app; music'), 'Use a tag name without commas or semicolons.');
});

test("a reused file's custom labels the repository lacks are missing, matched without case", () => {
  assert.deepEqual(missingCustomLabels(['App: Music', 'bug'], ['app: music', 'os: ios']), ['os: ios']);
});

test("a reused file's custom label that customLabelProblem refuses is not among those Create makes", () => {
  assert.deepEqual(missingCustomLabels([], ['build', 'status-review', '-R', 'x'.repeat(51), 'web']), ['web']);
});
