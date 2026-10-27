import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { AGENT_SKILLS_BLOCK, agentSetupWrites } from './agent-setup.ts';

const DOCS = ['docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md'];

const written = (files: Record<string, string>) => new Map(agentSetupWrites(files).map(({ path, content }) => [path, content]));

test('a block already in AGENTS.md is replaced where it is, keeping the sections around it, even with a CLAUDE.md', () => {
  const agents = '# lar-web\n\nRead the README.\n\n## Agent skills\n\n### Issue tracker\nLinear. See `docs/agents/issue-tracker.md`.\n\n'
    + '```md\n## Not a heading\n```\n\n## Testing\n\nRun `pnpm test`.\n';
  const writes = written({ 'AGENTS.md': agents, 'CLAUDE.md': '# lar-web\n' });
  assert.equal(writes.get('AGENTS.md'), `# lar-web\n\nRead the README.\n\n${AGENT_SKILLS_BLOCK}\n## Testing\n\nRun \`pnpm test\`.\n`);
  assert.equal(writes.has('CLAUDE.md'), false);
});

test('a block at the end of CLAUDE.md is replaced to the end of the file', () => {
  const writes = written({ 'CLAUDE.md': '# lar-web\n\n## Agent skills\n\nOld pointers.\n' });
  assert.equal(writes.get('CLAUDE.md'), `# lar-web\n\n${AGENT_SKILLS_BLOCK}`);
});

test('with no block, it goes at the end of CLAUDE.md, leaving AGENTS.md alone', () => {
  const writes = written({ 'CLAUDE.md': '# lar-web\n\nUse pnpm.', 'AGENTS.md': '# lar-web\n' });
  assert.equal(writes.get('CLAUDE.md'), `# lar-web\n\nUse pnpm.\n\n${AGENT_SKILLS_BLOCK}`);
  assert.equal(writes.has('AGENTS.md'), false);
});

test('with no block and no CLAUDE.md, it goes at the end of AGENTS.md', () => {
  assert.equal(written({ 'AGENTS.md': '# lar-web\n\nUse pnpm.\n' }).get('AGENTS.md'), `# lar-web\n\nUse pnpm.\n\n${AGENT_SKILLS_BLOCK}`);
});

test('with neither file, AGENTS.md is created holding the block', () => {
  assert.equal(written({}).get('AGENTS.md'), AGENT_SKILLS_BLOCK);
});

test('the three docs/agents/ files are written whole, replacing what the repository has', () => {
  const writes = agentSetupWrites({ 'AGENTS.md': '', 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n\n## Wayfinding operations\n' });
  assert.deepEqual(writes.map(({ path }) => path), ['AGENTS.md', ...DOCS]);
  for (const { path, content } of writes.slice(1)) {
    assert.ok(content.startsWith('# ') && content.endsWith('\n'), path);
    assert.ok(AGENT_SKILLS_BLOCK.includes(`\`${path}\``), `the block points at ${path}`);
  }
});

test('issue-tracker.md has no Wayfinding section', () => {
  assert.doesNotMatch(written({}).get('docs/agents/issue-tracker.md')!, /wayfind/i);
});

test('domain.md describes single-context and multi-context repositories', () => {
  const domain = written({}).get('docs/agents/domain.md')!;
  for (const name of ['GLOSSARY.md', 'docs/adr/', 'GLOSSARY-MAP.md']) assert.ok(domain.includes(`\`${name}\``), name);
});

test("triage-labels.md lists every workflow label and maps Matt Pocock's triage roles", () => {
  const labels = written({}).get('docs/agents/triage-labels.md')!;
  for (const name of ['bug', 'feature', 'improvement', 'concept', 'decision-grill', 'decision-prototype', 'decision-research',
    'decision-task', 'build', 'active', 'blocked']) {
    assert.match(labels, new RegExp(`^\\| \`${name}\` \\|`, 'm'), name);
  }
  for (const [role, factory] of [['needs-triage', 'List'], ['needs-info', 'Needs you'], ['ready-for-human', 'Needs you'],
    ['wontfix', 'not planned'], ['bug', '`bug`'], ['enhancement', '`feature` or `improvement`'], ['ready-for-agent', 'board']]) {
    assert.match(labels, new RegExp(`^\\| \`${role}\` \\| .*${factory}`, 'm'), role);
  }
});
