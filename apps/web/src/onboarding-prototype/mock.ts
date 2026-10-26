// PROTOTYPE (#363), throwaway: the mocked T3 projects, checks and Clashes the onboarding wizard variants walk through.
// Nothing here reads the server, GitHub or T3.

export type Provider = 'GitHub' | 'Azure DevOps';

export interface T3Project {
  name: string;
  path: string;
  origin: string;
  /** The answers in the repository's `.lar-factory.json` on its default branch, if it has one. */
  config?: { itemSource: string; show: string; role: string; platform: string; labels: string[] };
}

export const providerOf = (origin: string): Provider => (origin.includes('dev.azure.com') ? 'Azure DevOps' : 'GitHub');

/** owner/repo, or the Azure project/repo, from an origin URL. */
export const repoOf = (origin: string) => {
  const azure = origin.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)/);
  if (azure) return `${azure[1]}/${azure[2]}/${azure[3]}`;
  return origin.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '');
};

export const T3_PROJECTS: T3Project[] = [
  { name: 'lar-web', path: '~/code/lar-web', origin: 'git@github.com:maddec01/lar-web.git' },
  { name: 'fabrikam-api', path: '~/code/fabrikam-api', origin: 'https://dev.azure.com/contoso/Fabrikam/_git/fabrikam-api' },
  {
    name: 'lar-docs', path: '~/code/lar-docs', origin: 'git@github.com:maddec01/lar-docs.git',
    config: { itemSource: 'GitHub Project maddec01 #3 (lar)', show: 'All items', role: 'Public docs site', platform: 'Docs', labels: ['build', 'decision', 'blocked'] },
  },
];

export const GITHUB_PROJECTS = ['maddec01 #3 · lar', 'maddec01 #7 · Side projects'];
export const AZURE_TEAMS = ['Fabrikam Team', 'Platform Team'];

export const LABELS = [
  { name: 'build', note: 'Marks a build issue' },
  { name: 'decision', note: 'Marks a decision sub-issue' },
  { name: 'blocked', note: 'Marks a blocked slice' },
  { name: 'applies-to-web', note: 'Applicability label for this repository' },
];

/** Labels already on the repository; onboarding leaves them alone. */
export const FOREIGN_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'wontfix'];

export interface CheckSpec {
  id: string;
  group: 'Commands' | 'Setup';
  title: string;
  passed: string;
  /** The first run fails with this; Retry passes. */
  failure?: { text: string; command: string };
  azureOnly?: boolean;
  githubOnly?: boolean;
}

export const CHECKS: CheckSpec[] = [
  { id: 't3', group: 'Commands', title: 't3 and T3 Code', passed: 't3 0.1.4-nightly · T3 Code running' },
  { id: 'gh', group: 'Commands', title: 'gh 2.94.0 or later', passed: 'gh 2.96.1', githubOnly: true },
  { id: 'gh-login', group: 'Commands', title: 'gh login', passed: 'Logged in as maddec01', githubOnly: true },
  { id: 'gh-scope', group: 'Commands', title: 'gh project scope', passed: 'Scopes: repo, project, read:org', githubOnly: true,
    failure: { text: 'gh lacks the project scope, so the board can’t read or move items on a GitHub Project.', command: 'gh auth refresh -s project' } },
  { id: 'git', group: 'Commands', title: 'git', passed: 'git 2.50.1' },
  { id: 'jq', group: 'Commands', title: 'jq and curl', passed: 'jq 1.7.1 · curl 8.7.1' },
  { id: 'az', group: 'Commands', title: 'az login', passed: 'az 2.67.0 · logged in to contoso', azureOnly: true },
  { id: 'az-ext', group: 'Commands', title: 'azure-devops extension', passed: 'azure-devops 1.0.1', azureOnly: true,
    failure: { text: 'az has no azure-devops extension, so the board can’t read the team’s sprint or backlog.', command: 'az extension add --name azure-devops' } },
  { id: 'project', group: 'Setup', title: 'T3 project is the main checkout', passed: 'Origin matches, on the default branch' },
  { id: 'source', group: 'Setup', title: 'Item source readable', passed: 'Lists 23 open items' },
  { id: 'labels', group: 'Setup', title: 'Labels', passed: 'Created 3, left 4 that onboarding didn’t create alone' },
];

export interface Clash {
  id: string;
  kind: 'fixed' | 'agent';
  file: string;
  title: string;
  reason: string;
  /** The proposed edit as removed and added lines. */
  edit: { remove?: string; add?: string };
  ticked: boolean;
}

export const CLASHES: Clash[] = [
  { id: 'scratch', kind: 'fixed', file: '.scratch/', title: 'Delete Matt Pocock’s local tracker', ticked: false,
    reason: '12 tickets in .scratch/ from the local tracker. The provider holds the tickets now; delete only once they’re moved.',
    edit: { remove: '.scratch/ (12 files)' } },
  { id: 'context', kind: 'fixed', file: 'CONTEXT.md', title: 'Rename CONTEXT.md to GLOSSARY.md', ticked: true,
    reason: 'Domain docs read GLOSSARY.md; CONTEXT.md is the old name.',
    edit: { remove: 'CONTEXT.md', add: 'GLOSSARY.md' } },
  { id: 'push-main', kind: 'agent', file: 'AGENTS.md:14', title: 'Rule to push small fixes to main', ticked: true,
    reason: 'The factory lands every change through a PR Pedro merges; this rule makes builders push to main.',
    edit: { remove: '- Small fixes can go straight to main.', add: '- Every change goes through a PR.' } },
  { id: 'linear', kind: 'agent', file: 'CLAUDE.md:3', title: 'Tracks work in Linear', ticked: true,
    reason: 'Items live on the repository’s provider; an agent following this would file tickets in Linear.',
    edit: { remove: 'Track all work in Linear (team WEB).', add: 'Track work as issues on GitHub (see docs/agents/issue-tracker.md).' } },
  { id: 'no-tests', kind: 'agent', file: '.cursor/rules/speed.mdc:8', title: 'Skip tests to save time', ticked: false,
    reason: 'Builds must pass their checks before review; skipping tests makes the approver hold every PR.',
    edit: { remove: 'Skip running tests unless asked.' } },
];

/** A project skill named like a bundled one; onboarding blocks until delete or rename is picked. */
export const SKILL_CLASH = { path: '.claude/skills/code-review/', bundled: 'code-review', suggested: 'web-code-review' };

/** What onboarding writes whatever is ticked. */
export const ALWAYS_WRITTEN = [
  { file: 'AGENTS.md', what: '## Agent skills block (replaces the existing one)' },
  { file: 'docs/agents/issue-tracker.md', what: 'replaces Matt Pocock’s' },
  { file: 'docs/agents/triage-labels.md', what: 'replaces Matt Pocock’s' },
  { file: 'docs/agents/domain.md', what: 'new' },
  { file: '.lar-factory.json', what: 'Repository config: role, item source, show setting and labels' },
];

export const AGENT_MODELS: Record<string, string[]> = {
  Claude: ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5'],
  Codex: ['gpt-5.5', 'gpt-5.5-mini'],
};

export const AGENT_LOG = [
  'Reading AGENTS.md',
  'Reading CLAUDE.md',
  'Reading .cursor/rules/*.mdc (3 files)',
  'Reading .claude/skills/ (4 skills)',
  'Comparing against the factory’s rules',
  'Writing reasons and proposed edits',
];
