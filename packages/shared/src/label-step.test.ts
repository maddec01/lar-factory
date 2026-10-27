import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { STATUS_LABELS, labelPlan, labelsToCreate, workflowLabelsMissing } from './label-step.ts';
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
