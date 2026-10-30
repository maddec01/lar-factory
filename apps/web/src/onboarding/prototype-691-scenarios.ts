// PROTOTYPE (#691), throwaway: three stub scenarios for the onboarding tradeoff prototype (round 2). Every question,
// detected fact and deferred choice is mocked here; nothing reads a provider or writes anything. Each option carries
// its tradeoff three ways (a cost line, what you get and give up, an access limit) and each question says whether it
// can change later, so the variants differ only in how a step presents them.

export const PROTOTYPE_691 = import.meta.env.MODE !== 'test' && (import.meta.env.DEV || import.meta.env.VITE_LAR_PROTOTYPE === '1');

type QuestionId = 'repository' | 'role' | 'consent' | 'docs' | 'skills' | 'connections';

type Option = {
  id: string; title: string;
  /** One short line: what the option costs. */
  cost: string;
  /** What the factory does for you with this option picked (or ticked). */
  get: string;
  /** What you give up with this option picked; for a tick box, what you give up leaving it unticked. */
  lose: string;
  /** Set when detected access refuses the option: the badge, and the plain reason. */
  disabled?: string;
  limit?: string;
};

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
  /** Whether detection settles it for this scenario (round 1's variant C skipped it; unused in round 2). */
  settled: boolean;
  /** Set when a shared Repository config supplies the default; the user can override it locally. */
  fromConfig?: boolean;
  /** One line about the question as a whole. */
  note?: string;
  /** Whether and how you can change the answer later. */
  later: string;
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
  options: projects.map(([name, path], i) => ({
    id: name, title: name,
    cost: i === 0 ? `Agents work in ${path}; the board shows this repository's work.` : `Agents would work in ${path} instead.`,
    get: `Agents work in ${path}, and the board shows ${name}'s work.`,
    lose: i === 0 ? 'Nothing: you can onboard your other projects one at a time later.' : `${projects[0]![0]}, the project you started from, stays off the board until you onboard it.`,
  })),
  fallback: projects[0]![0],
  later: 'Onboard another repository any time. This one stays on the board until you remove it.',
});

const role = (proposed: string, settled: boolean): Question => ({
  id: 'role', title: 'What is your role in this repository?', short: 'Repository role',
  detected: 'Proposed from your access and the repository’s history.', kind: 'text', settled,
  options: [{ id: 'role', title: 'Repository role', cost: '',
    get: 'Agents word tickets and handovers to fit how you work here.',
    lose: 'Nothing: the Repository role gives the factory no access and takes none away.' }],
  fallback: proposed,
  note: 'Context only: agents use it to phrase work. It grants or refuses nothing.',
  later: 'Edit it any time in Settings. It applies to work written after the change.',
});

const consent = (options: Option[], fallback: string[]): Question => ({
  id: 'consent', title: 'What may the factory write for you?', short: 'Write consent',
  detected: 'Limited to the access your credential has. Nothing was test-written.', kind: 'many', settled: false, options, fallback,
  note: 'Consent stays personal, even when a Repository config is shared.',
  later: 'Change write consent any time in Settings. The factory checks it before every write, so a change applies to the next one.',
});

const OPEN_PR = (fork: boolean): Option => ({
  id: 'open-pr', title: fork ? 'Open pull requests from a fork' : 'Open pull requests', cost: 'How builds deliver. Off: builds stop at a pushed branch.',
  get: fork ? 'Builds finish by opening a pull request from your fork.' : 'Builds finish by opening a pull request for review.',
  lose: 'Builds stop at a pushed branch, and you open each pull request yourself.',
});
const EDIT_BODY = (id: string, title: string, thing: string): Option => ({
  id, title, cost: 'Updates published text in place. Off: updates arrive as comments.',
  get: `Published text stays current: the factory updates ${thing} in place.`,
  lose: `Every update arrives as a new comment, so ${thing} go stale.`,
});
const COMMENT = (thing: string): Option => ({
  id: 'comment', title: `Comment on ${thing}`, cost: `Fallback when a ${thing === 'issues' ? 'body' : 'description'} edit is refused. Off: you get a handover.`,
  get: `When an edit is refused, the factory posts the update as a comment on the ${thing.replace(/s$/, '')}.`,
  lose: 'When an edit is refused, you get a handover with the text to post yourself.',
});
const OPEN_TICKET = (id: string, title: string, thing: string): Option => ({
  id, title, cost: `Publishing creates ${thing === 'issues' ? 'tickets' : thing} for your work. Off: you get a handover to post.`,
  get: `When you publish, the factory opens ${thing} under your name.`,
  lose: 'When you publish, you get a handover with the text to post yourself, one per ticket.',
});

const PRIVATE_DOCS: Option = {
  id: 'private', title: 'Keep private drafts', cost: 'Only you see them. Teammates can’t use them until you publish them through a build PR.',
  get: 'Domain docs drafts stay on this Mac, and builds still read them.',
  lose: 'Teammates can’t read private domain docs until a build PR publishes them.',
};
const DOCS_LATER = 'You can switch later. Private drafts stay private until a build PR publishes them.';

const docsNone: Question = {
  id: 'docs', title: 'Where should domain docs live?', short: 'Domain docs',
  detected: 'No glossary or ADR folder found.', kind: 'one', settled: true,
  options: [PRIVATE_DOCS, {
    id: 'repo', title: 'Start docs in the repository', cost: 'A later build PR adds a glossary and ADR folder; teammates review and see them. Nothing is written now.',
    get: 'A later build PR adds a glossary and ADR folder, so teammates can read them. Nothing is written now.',
    lose: 'Every domain docs change waits for PR review before teammates see it.',
  }],
  fallback: 'private',
  later: DOCS_LATER,
};

const WORKFLOW = /grill|prd|triage|issue/;
const skills = (names: string[], settled: boolean, fromConfig = false): Question => ({
  id: 'skills', title: 'Which project skills guide coding?', short: 'Project skills',
  detected: `Found ${names.length} skills in .claude/skills.`, kind: 'many', settled, fromConfig,
  options: names.map((n) => WORKFLOW.test(n)
    ? { id: n, title: n, cost: 'Workflow skill: may pull agents off the factory workflow.',
      get: 'Builds load it, but it may make agents run its own steps (questions, tickets, PRDs) instead of the factory’s.',
      lose: 'Nothing the factory needs: builds keep to the factory’s own steps.' }
    : { id: n, title: n, cost: 'Coding guidance: shapes how builds write and test code.',
      get: 'Builds follow it when they write and test code.',
      lose: 'Builds write and test code without this guidance.' }),
  fallback: names.filter((n) => !WORKFLOW.test(n)),
  note: 'Only ticked skills guide builds. Changes apply to future builds only.',
  later: fromConfig
    ? 'The Repository config picks these for the team. A change here applies on this Mac only, to future builds.'
    : 'Change them any time in Settings. Changes apply to future builds only.',
});

const connections = (repos: string[], settled: boolean): Question => ({
  id: 'connections', title: 'Which onboarded repositories is this connected to?', short: 'Connections',
  detected: repos.length ? `${repos.length} other onboarded repositories.` : 'No other onboarded repositories.', kind: 'many', settled,
  options: repos.map((r) => ({
    id: r, title: r, cost: 'Refinement asks before planning a build there. Unticked repositories are read for context only.',
    get: `Refinement can plan builds in ${r} too, and asks before it does.`,
    lose: `Refinement still reads ${r} for context but won’t plan builds there.`,
  })),
  fallback: [],
  note: 'A Connection lets refinement plan builds across both repositories. You can change it any time.',
  later: 'Change Connections any time. Work already planned keeps its plan.',
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
        OPEN_TICKET('open-issue', 'Open issues', 'issues'),
        COMMENT('issues'),
        EDIT_BODY('edit-own', 'Edit your own issue bodies', 'your issue bodies'),
        OPEN_PR(true),
        { id: 'labels', title: 'Add labels', cost: 'Refused by GitHub: you have no triage access.', disabled: 'Refused',
          limit: 'GitHub refuses this: your access to acme/iapp has no triage.',
          get: 'Nothing while your access has no triage.',
          lose: 'The factory can’t add labels, so your issues go out unlabelled and maintainers sort them.' },
        { id: 'sub-issues', title: 'Link sub-issues and blocked-by', cost: 'Refused by GitHub: links are written as text instead.', disabled: 'Refused',
          limit: 'GitHub refuses this: your access to acme/iapp has no triage.',
          get: 'Nothing while your access has no triage.',
          lose: 'Without triage access, the factory can’t add sub-issues or blocked-by, so it links work in the ticket body as text.' },
        { id: 'close', title: 'Close issues you opened', cost: 'Unverified: no test write. Asked again before first use.',
          get: 'The factory closes issues you opened when their work ships. It asks once more before the first time, since this write wasn’t checked.',
          lose: 'Finished issues stay open until you close them.' },
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
        OPEN_TICKET('create-item', 'Create work items', 'work items'),
        COMMENT('work items'),
        EDIT_BODY('edit-item', 'Edit work item descriptions', 'work item descriptions'),
        OPEN_PR(false),
        { id: 'link', title: 'Link related work items', cost: 'Unverified: no test write. Asked again before first use.',
          get: 'Related work items link to each other natively. The factory asks once more before the first time, since this write wasn’t checked.',
          lose: 'Related work items are named in the description as text, so Boards can’t track them.' },
      ], ['create-item', 'comment', 'edit-item', 'open-pr']),
      {
        id: 'docs', title: 'Where should domain docs live?', short: 'Domain docs',
        detected: 'Found docs/glossary.md and docs/decisions/; the Repository config points at them.', kind: 'one', settled: true, fromConfig: true,
        options: [
          { id: 'existing', title: 'Use docs/glossary.md and docs/decisions/', cost: 'Builds write entries through their PRs; teammates review and use them.',
            get: 'Builds add glossary and ADR entries through their PRs, so teammates review and use them.',
            lose: 'Every domain docs change waits for PR review before anyone can rely on it.' },
          PRIVATE_DOCS,
        ],
        fallback: 'existing',
        later: 'The Repository config sets this for the team. Your choice overrides it on this Mac only, and you can switch back any time.',
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
        OPEN_TICKET('open-issue', 'Open issues', 'issues'),
        EDIT_BODY('edit', 'Edit issue bodies', 'issue bodies'),
        { id: 'labels', title: 'Add labels', cost: 'Only labels your Vocabulary mapping names. Off: tickets go out unlabelled.',
          get: 'Issues get the labels your Vocabulary mapping names, and no others.',
          lose: 'Issues go out unlabelled, and you sort them yourself.' },
        { id: 'sub-issues', title: 'Link sub-issues and blocked-by', cost: 'Native links between published tickets. Off: links are written as text.',
          get: 'Published issues link to each other as sub-issues and blocked-by, so GitHub tracks them.',
          lose: 'The factory links work in the ticket body as text, so GitHub can’t track it.' },
        OPEN_PR(false),
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
