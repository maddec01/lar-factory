import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { AGENT_DOC_PATHS, AGENT_SKILLS_BLOCK, agentSetupWrites, withoutAgentSkills } from './agent-setup.ts';

const DOCS = ['docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md'];

const written = (files: Record<string, string>) => new Map(agentSetupWrites(files, 'GitHub').map(({ path, content }) => [path, content]));

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
  const writes = agentSetupWrites({ 'AGENTS.md': '', 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n\n## Wayfinding operations\n' }, 'GitHub');
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

test("triage-labels.md maps Matt Pocock's triage roles to work-record kinds and Statuses", () => {
  const labels = written({}).get('docs/agents/triage-labels.md')!;
  for (const [role, factory] of [['needs-triage', 'Status List'], ['needs-info', 'Status Needs you'], ['ready-for-human', 'Status Needs you'],
    ['wontfix', 'Abandon'], ['bug', 'Kind `bug`'], ['enhancement', 'Kind `feature`.*`improvement`'], ['ready-for-agent', 'board']]) {
    assert.match(labels, new RegExp(`^\\| \`${role}\` \\| .*${factory}`, 'm'), role);
  }
});

test('the docs/agents/ paths are the three files the setup writes', () => {
  assert.deepEqual(AGENT_DOC_PATHS, DOCS);
});

test('removing the block at the start of a file leaves the file from the next level one heading on', () => {
  assert.equal(withoutAgentSkills('## Agent skills\n\nOld pointers.\n\n# lar-web\n\nUse pnpm.\n'), '# lar-web\n\nUse pnpm.\n');
});

test('removing the block in the middle keeps the sections around it byte for byte, past a fenced ## line inside the block', () => {
  const before = '# lar-web\r\n\nRead the README.  \n\n';
  const after = '## Testing\n\nRun `pnpm test`.\n';
  const block = '## Agent skills\n\n### Issue tracker\nLinear.\n\n```md\n## Not a heading\n```\n\n';
  assert.equal(withoutAgentSkills(`${before}${block}${after}`), `${before}${after}`);
});

test('removing the block at the end of a file keeps everything before it', () => {
  assert.equal(withoutAgentSkills(`# lar-web\n\nUse pnpm.\n\n${AGENT_SKILLS_BLOCK}`), '# lar-web\n\nUse pnpm.\n\n');
});

test('a file with no block has nothing to remove', () => {
  assert.equal(withoutAgentSkills('# lar-web\n\n### Agent skills\n'), null);
});

for (const provider of ['GitHub', 'Azure DevOps'] as const) {
  test(`${provider} guidance uses the two installed skills`, () => {
    const text = agentSetupWrites({}, provider).map(({ content }) => content).join('\n');
    assert.match(text, /lar-shape/);
    assert.match(text, /lar-build/);
    assert.match(text, /`lar-work`/);
    assert.doesNotMatch(text, /domain-modeling|to-tickets/);
  });

  test(`${provider} guidance keeps factory progress off tickets`, () => {
    const text = agentSetupWrites({}, provider).map(({ content }) => content).join('\n');
    assert.match(text, /no step writes it to an? (issue|work item)/);
    assert.doesNotMatch(text, /status-|retag|sub-issue|child Task|--add-label|slice\.sh|`(active|blocked|build|decision-\w+)`/);
  });

  test(`${provider} guidance routes optional publication through exact approval and keeps native workflow authoritative`, () => {
    const text = agentSetupWrites({}, provider).map(({ content }) => content).join('\n');
    assert.match(text, /shared\/issue-tracker\/publication\.md/);
    assert.match(text, /exact[\s\S]*approval/);
    assert.match(text, /Decisions and slices stay private/);
    assert.match(text, /native.*completion/);
    assert.doesNotMatch(text, /publishing isn't available|arrives in a later Lar Factory release/);
  });
}
