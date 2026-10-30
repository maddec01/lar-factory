// PROTOTYPE (#691), throwaway: three stub scenarios for the onboarding flow-shape prototype. Every question, detected
// fact and deferred choice is mocked here; nothing reads a provider or writes anything. The cost wording and the
// deferred list are shared by all three variants, which differ only in flow shape.

export const PROTOTYPE_691 = import.meta.env.MODE !== 'test' && (import.meta.env.DEV || import.meta.env.VITE_LAR_PROTOTYPE === '1');

type QuestionId = 'repository' | 'role' | 'consent' | 'docs' | 'skills' | 'connections';

type Option = { id: string; title: string; cost: string; disabled?: string };

/** One question onboarding asks, with its detected default and each option's cost. */
export type Question = {
  id: QuestionId;
  title: string;
  /** Short label for summary rows and the recap. */
  short: string;
  /** Where the default came from. */
  detected: string;
  kind: 'one' | 'many' | 'text';
  options: Option[];
  /** The detected default: an option id, option ids, or the proposed text. */
  fallback: string | string[];
  /** Whether detection settles it for this scenario (variant C skips it and lists it in the recap). */
  settled: boolean;
  /** Set when a shared Repository config supplies the default; the user can override it locally. */
  fromConfig?: boolean;
  /** One line about the question as a whole. */
  note?: string;
};

type Detected = { label: string; value: string; tone?: 'warning' | 'info' };

export type Scenario = {
  id: '1' | '2' | '3';
  name: string;
  repo: string;
  detected: Detected[];
  questions: Question[];
};

export type Answers = Partial<Record<QuestionId, string | string[]>>;

/** Deferred until a feature needs them; the same for every scenario and variant. */
export const DEFERRED: { name: string; when: string }[] = [
  { name: 'Vocabulary mapping and publication', when: 'Asked the first time you publish refined work.' },
  { name: 'Repository additions: Repository config, labels or tags, agent guidance, domain docs PRs', when: 'Offered when you choose to add one; none is required.' },
  { name: 'Clash resolution', when: 'Asked when a project rule blocks factory work.' },
  { name: 'Dependencies', when: 'Asked during refinement, when work needs another repository.' },
];

export const LOCAL_NOTE = 'Factory progress (Status, the Queue, build phases, slices and reviews) stays on this Mac for every repository.';

const repository = (projects: [string, string][], settled: boolean): Question => ({
  id: 'repository', title: 'Which repository are you onboarding?', short: 'Repository',
  detected: `The T3 project you started from: ${projects[0]![0]}.`, kind: 'one', settled,
  options: projects.map(([name, path], i) => ({ id: name, title: name, cost: i === 0 ? `Agents work in ${path}; the board shows this repository's work.` : `Agents would work in ${path} instead.` })),
  fallback: projects[0]![0],
});

const role = (proposed: string, settled: boolean): Question => ({
  id: 'role', title: 'What is your role in this repository?', short: 'Repository role',
  detected: 'Proposed from your access and the repository’s history.', kind: 'text', settled, options: [],
  fallback: proposed,
  note: 'Context only: agents use it to phrase work. It grants or refuses nothing.',
});

const consent = (options: Option[], fallback: string[]): Question => ({
  id: 'consent', title: 'What may the factory write for you?', short: 'Write consent',
  detected: 'Limited to the access your credential has. Nothing was test-written.', kind: 'many', settled: false, options, fallback,
  note: 'Consent stays personal, even when a Repository config is shared.',
});

const PRIVATE_DOCS: Option = { id: 'private', title: 'Keep private drafts', cost: 'Only you see them. Teammates can’t use them until you publish them through a build PR.' };

const docsNone: Question = {
  id: 'docs', title: 'Where should domain docs live?', short: 'Domain docs',
  detected: 'No glossary or ADR folder found.', kind: 'one', settled: true,
  options: [PRIVATE_DOCS, { id: 'repo', title: 'Start docs in the repository', cost: 'A later build PR adds a glossary and ADR folder; teammates review and see them. Nothing is written now.' }],
  fallback: 'private',
};

const skills = (names: string[], settled: boolean, fromConfig = false): Question => ({
  id: 'skills', title: 'Which project skills guide coding?', short: 'Project skills',
  detected: `Found ${names.length} skills in .claude/skills.`, kind: 'many', settled, fromConfig,
  options: names.map((n) => ({
    id: n, title: n,
    cost: /grill|prd|triage|issue/.test(n) ? 'Workflow skill: may pull agents off the factory workflow.' : 'Coding guidance: shapes how builds write and test code.',
  })),
  fallback: names.filter((n) => !/grill|prd|triage|issue/.test(n)),
  note: 'Only ticked skills guide builds. Changes apply to future builds only.',
});

const connections = (repos: string[], settled: boolean): Question => ({
  id: 'connections', title: 'Which onboarded repositories is this connected to?', short: 'Connections',
  detected: repos.length ? `${repos.length} other onboarded repositories.` : 'No other onboarded repositories.', kind: 'many', settled,
  options: repos.map((r) => ({ id: r, title: r, cost: 'Refinement asks before planning a build there. Unticked repositories are read for context only.' })),
  fallback: [],
  note: 'A Connection lets refinement plan builds across both repositories. You can change it any time.',
});

export const SCENARIOS: Scenario[] = [
  {
    id: '1', name: 'GitHub contributor, limited access', repo: 'acme/iapp',
    detected: [
      { label: 'Provider', value: 'GitHub' },
      { label: 'Item source', value: 'GitHub issues in acme/iapp' },
      { label: 'Credential access', value: 'Can open issues, comment and edit your own issue bodies. No triage: labels, sub-issues and blocked-by are refused.', tone: 'warning' },
      { label: 'Domain docs', value: 'None found' },
      { label: 'Repository config', value: 'None: every setting is yours' },
    ],
    questions: [
      repository([['IApp', '~/Developer/IApp'], ['lar-web', '~/Developer/lar-web']], true),
      role('Outside contributor: proposes changes through issues and PRs', false),
      consent([
        { id: 'open-issue', title: 'Open issues', cost: 'Publishing creates tickets for your work. Off: you get a handover to post.' },
        { id: 'comment', title: 'Comment on issues', cost: 'Fallback when a body edit is refused. Off: you get a handover.' },
        { id: 'edit-own', title: 'Edit your own issue bodies', cost: 'Updates published text in place. Off: updates arrive as comments.' },
        { id: 'open-pr', title: 'Open pull requests from a fork', cost: 'How builds deliver. Off: builds stop at a pushed branch.' },
        { id: 'labels', title: 'Add labels', cost: 'Refused by GitHub: you have no triage access.', disabled: 'Refused' },
        { id: 'sub-issues', title: 'Link sub-issues and blocked-by', cost: 'Refused by GitHub: links are written as text instead.', disabled: 'Refused' },
        { id: 'close', title: 'Close issues you opened', cost: 'Unverified: no test write. Asked again before first use.' },
      ], ['open-issue', 'comment', 'edit-own', 'open-pr']),
      docsNone,
      skills(['tdd', 'improve-codebase-architecture', 'grill-me', 'to-prd', 'triage-issue', 'design-an-interface'], false),
      connections([], true),
    ],
  },
  {
    id: '2', name: 'Azure DevOps team, shared config', repo: 'contoso/Payments/payments-api',
    detected: [
      { label: 'Provider', value: 'Azure DevOps' },
      { label: 'Item source', value: 'Boards work items in Payments\\API (from Repository config)', tone: 'info' },
      { label: 'Credential access', value: 'Contributor: create and edit work items, comment, open PRs.' },
      { label: 'Domain docs', value: 'docs/glossary.md and docs/decisions/' },
      { label: 'Repository config', value: '.lar-factory.json supplies the item source, domain docs locations and project skills. You can override each locally.', tone: 'info' },
    ],
    questions: [
      repository([['payments-api', '~/Developer/payments-api']], true),
      role('Team developer on Payments', false),
      consent([
        { id: 'create-item', title: 'Create work items', cost: 'Publishing creates work items for your work. Off: you get a handover to post.' },
        { id: 'comment', title: 'Comment on work items', cost: 'Fallback when a description edit is refused. Off: you get a handover.' },
        { id: 'edit-item', title: 'Edit work item descriptions', cost: 'Updates published text in place. Off: updates arrive as comments.' },
        { id: 'open-pr', title: 'Open pull requests', cost: 'How builds deliver. Off: builds stop at a pushed branch.' },
        { id: 'link', title: 'Link related work items', cost: 'Unverified: no test write. Asked again before first use.' },
      ], ['create-item', 'comment', 'edit-item', 'open-pr']),
      {
        id: 'docs', title: 'Where should domain docs live?', short: 'Domain docs',
        detected: 'Found docs/glossary.md and docs/decisions/; the Repository config points at them.', kind: 'one', settled: true, fromConfig: true,
        options: [
          { id: 'existing', title: 'Use docs/glossary.md and docs/decisions/', cost: 'Builds write entries through their PRs; teammates review and use them.' },
          PRIVATE_DOCS,
        ],
        fallback: 'existing',
      },
      skills(['dotnet-style', 'efcore-migrations', 'grill-me'], true, true),
      connections(['contoso/Payments/payments-web', 'contoso/Shared/identity'], false),
    ],
  },
  {
    id: '3', name: 'Your own repository, full access', repo: 'pedro/side-project',
    detected: [
      { label: 'Provider', value: 'GitHub' },
      { label: 'Item source', value: 'GitHub issues in pedro/side-project' },
      { label: 'Credential access', value: 'Owner: every write is allowed.' },
      { label: 'Domain docs', value: 'None found' },
      { label: 'Project skills', value: 'None found' },
      { label: 'Repository config', value: 'None: every setting is yours' },
    ],
    questions: [
      repository([['side-project', '~/Developer/side-project'], ['notes-app', '~/Developer/notes-app']], true),
      role('Owner and sole maintainer', true),
      consent([
        { id: 'open-issue', title: 'Open issues', cost: 'Publishing creates tickets for your work. Off: you get a handover to post.' },
        { id: 'edit', title: 'Edit issue bodies', cost: 'Updates published text in place. Off: updates arrive as comments.' },
        { id: 'labels', title: 'Add labels', cost: 'Only labels your Vocabulary mapping names. Off: tickets go out unlabelled.' },
        { id: 'sub-issues', title: 'Link sub-issues and blocked-by', cost: 'Native links between published tickets. Off: links are written as text.' },
        { id: 'open-pr', title: 'Open pull requests', cost: 'How builds deliver. Off: builds stop at a pushed branch.' },
      ], ['open-issue', 'edit', 'labels', 'sub-issues', 'open-pr']),
      docsNone,
      connections(['pedro/notes-app'], false),
    ],
  },
];

export const answerOf = (q: Question, answers: Answers) => answers[q.id] ?? q.fallback;

/** One line saying what a question's answer is. */
export function answerText(q: Question, answers: Answers): string {
  const a = answerOf(q, answers);
  if (q.kind === 'text') return a as string;
  if (q.kind === 'one') return q.options.find((o) => o.id === a)?.title ?? '—';
  const picked = q.options.filter((o) => (a as string[]).includes(o.id)).map((o) => o.title);
  if (!q.options.length) return 'Nothing to pick';
  return picked.length ? picked.join(', ') : 'None';
}

/** The cost line of the picked option, for single choices. */
export function answerCost(q: Question, answers: Answers): string | undefined {
  if (q.kind === 'text') return q.note;
  if (q.kind === 'one') return q.options.find((o) => o.id === answerOf(q, answers))?.cost;
  return q.note;
}
