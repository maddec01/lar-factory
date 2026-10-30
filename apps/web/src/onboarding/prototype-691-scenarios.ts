// PROTOTYPE (#691), throwaway: three stub scenarios for the onboarding prototype (round 3: deferred choices). Every
// question, detected fact, deferred choice and later prompt is mocked here; nothing reads a provider or writes
// anything. Round 3 shows only each option's cost line (round 2's A1); the other tradeoff fields are left from round 2.

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

/** D2: the one line a step says about the choice deferred from it, if any. */
export function deferredOnStep(scenario: Scenario, id: QuestionId): string | null {
  const github = scenario.detected[0]!.value === 'GitHub';
  const types = github ? 'labels' : 'work item types and tags';
  switch (id) {
    case 'repository': return scenario.detected.some((d) => d.label === 'Repository config' && !d.value.startsWith('None'))
      ? null : 'You’ll be offered a shared Repository config when a setting is worth sharing with your team.';
    case 'consent': return `You’ll map the factory’s kinds to your ${types}, and choose how to publish, the first time you publish refined work.`;
    case 'docs': return 'You’ll choose whether to publish drafts when a build first writes them.';
    case 'skills': return 'If a project rule blocks factory work, you’ll choose how to resolve it then.';
    case 'connections': return 'If work needs a repository that isn’t onboarded, refinement asks then.';
    default: return null;
  }
}

/** One option on a later prompt, with its cost line; `disabled` is the badge when detected access refuses it. */
export type LaterOption = { id: string; title: string; cost: string; disabled?: string };
type LaterQuestion = { title: string; detected: string; options: LaterOption[]; fallback: string };
/** One row of the Vocabulary mapping: a factory term and the team's ticket types or labels it could map to. */
type MappingRow = { term: string; what: string; options: LaterOption[]; fallback: string };

/** The just-in-time prompts a feature raises after onboarding; the same in every variant. */
export type LaterPrompts = {
  publish: { trigger: string; where: LaterQuestion; mappingHelp: string; mapping: MappingRow[]; limits: string[] };
  addition: { trigger: string; question: LaterQuestion; limits: string[] };
};

const BODY_LINE: LaterOption = { id: 'body', title: 'A line in the ticket body', cost: 'Readers see it; filters and boards can’t.' };
const LEAVE_OUT: LaterOption = { id: 'none', title: 'Leave it out', cost: 'Tickets don’t say what they are; you sort them yourself.' };
const refusedLabel = (name: string): LaterOption => ({ id: `label-${name}`, title: `Label “${name}”`, cost: 'Refused by GitHub: you have no triage access.', disabled: 'Refused' });
const label = (name: string, found = true): LaterOption => ({ id: `label-${name}`, title: `Label “${name}”`,
  cost: found ? 'Filters and boards can find it.' : 'Not in the repository yet: the factory creates it on first use.' });
const adoType = (name: string): LaterOption => ({ id: `type-${name}`, title: `${name} work item`, cost: 'Boards shows it in its own backlog level.' });
const adoTag = (name: string): LaterOption => ({ id: `tag-${name}`, title: `Tag “${name}” on a User Story`, cost: 'Stays in the team’s backlog; a query finds it.' });

export const LATER: Record<Scenario['id'], LaterPrompts> = {
  '1': {
    publish: {
      trigger: 'You’re publishing “Offline sync” to acme/iapp: one concept and three builds.',
      where: { title: 'Where should refined work go?', detected: 'Your access can open issues and edit your own issue bodies.', fallback: 'issues', options: [
        { id: 'issues', title: 'Open issues in acme/iapp', cost: 'Maintainers see them as issues from you; links between them are written as text.' },
        { id: 'handover', title: 'Give me a handover to post', cost: 'You post each ticket yourself; the factory can’t keep them current.' },
      ] },
      mappingHelp: 'How each ticket says what it is. acme/iapp has labels bug and enhancement, but you can’t add labels.',
      mapping: [
        { term: 'Concept', what: 'The map issue pairing its builds and decisions', fallback: 'body', options: [BODY_LINE, refusedLabel('epic'), LEAVE_OUT] },
        { term: 'Build', what: 'One PR’s worth of work', fallback: 'body', options: [BODY_LINE, LEAVE_OUT] },
        { term: 'Bug', what: 'Kind', fallback: 'body', options: [BODY_LINE, refusedLabel('bug'), LEAVE_OUT] },
        { term: 'Feature', what: 'Kind', fallback: 'body', options: [BODY_LINE, refusedLabel('enhancement'), LEAVE_OUT] },
        { term: 'Improvement', what: 'Kind', fallback: 'body', options: [BODY_LINE, refusedLabel('enhancement'), LEAVE_OUT] },
      ],
      limits: ['No triage access: labels, sub-issues and blocked-by are refused, so kinds and links go in the body as text.'],
    },
    addition: {
      trigger: 'Refinement would mark kinds with labels in acme/iapp.',
      question: { title: 'Add the factory’s labels to acme/iapp?', detected: 'acme/iapp has bug and enhancement; concept and build are missing.', fallback: 'handover', options: [
        { id: 'create', title: 'Create concept and build labels', cost: 'Refused by GitHub: you have no triage access.', disabled: 'Refused' },
        { id: 'handover', title: 'Ask a maintainer', cost: 'You get a handover with the labels to request; until then kinds stay in the body.' },
        { id: 'not-now', title: 'Not now', cost: 'Kinds stay as a line in the body; filters can’t find them. Asked again only from Settings.' },
      ] },
      limits: ['Without triage, the factory can’t create or add labels here.'],
    },
  },
  '2': {
    publish: {
      trigger: 'You’re publishing “Refund retries” to Payments\\API: one concept and two builds.',
      where: { title: 'Where should refined work go?', detected: 'Your access can create and edit work items in Payments\\API.', fallback: 'items', options: [
        { id: 'items', title: 'Create work items in Payments\\API', cost: 'The team sees them on its board; related items are linked once you confirm.' },
        { id: 'handover', title: 'Give me a handover to post', cost: 'You create each work item yourself; the factory can’t keep them current.' },
      ] },
      mappingHelp: 'How each ticket says what it is. Payments\\API uses Epic, Feature, User Story and Bug.',
      mapping: [
        { term: 'Concept', what: 'The map item pairing its builds and decisions', fallback: 'type-Feature', options: [adoType('Feature'), adoType('Epic'), BODY_LINE] },
        { term: 'Build', what: 'One PR’s worth of work', fallback: 'type-User Story', options: [adoType('User Story'), { id: 'type-Task', title: 'Task work item', cost: 'Hidden from the backlog; only sprint boards show it.' }] },
        { term: 'Bug', what: 'Kind', fallback: 'type-Bug', options: [adoType('Bug'), adoTag('bug')] },
        { term: 'Feature', what: 'Kind', fallback: 'tag-feature', options: [adoTag('feature'), BODY_LINE] },
        { term: 'Improvement', what: 'Kind', fallback: 'tag-improvement', options: [adoTag('improvement'), BODY_LINE] },
      ],
      limits: ['Linking related work items wasn’t test-written: the factory asks once more before the first link.'],
    },
    addition: {
      trigger: 'Refinement would mark kinds with tags in Payments\\API.',
      question: { title: 'Use the factory’s tags in Payments\\API?', detected: 'No feature or improvement tags exist yet. Contributors can add tags as they use them.', fallback: 'tags', options: [
        { id: 'tags', title: 'Add feature and improvement tags as used', cost: 'Teammates see new tags in Boards; queries can find factory work.' },
        { id: 'not-now', title: 'Not now', cost: 'Kinds stay as a line in the description; queries can’t find them.' },
      ] },
      limits: ['The Repository config doesn’t name tags, so this choice is yours on this Mac.'],
    },
  },
  '3': {
    publish: {
      trigger: 'You’re publishing “Dark mode” to pedro/side-project: one concept and two builds.',
      where: { title: 'Where should refined work go?', detected: 'You own pedro/side-project: every write is allowed.', fallback: 'issues', options: [
        { id: 'issues', title: 'Open issues in pedro/side-project', cost: 'Linked as sub-issues and blocked-by, so GitHub tracks them.' },
        { id: 'handover', title: 'Give me a handover to post', cost: 'You post each ticket yourself; the factory can’t keep them current.' },
      ] },
      mappingHelp: 'How each ticket says what it is. pedro/side-project has GitHub’s default labels.',
      mapping: [
        { term: 'Concept', what: 'The map issue pairing its builds and decisions', fallback: 'label-concept', options: [label('concept', false), BODY_LINE] },
        { term: 'Build', what: 'One PR’s worth of work', fallback: 'label-build', options: [label('build', false), BODY_LINE] },
        { term: 'Bug', what: 'Kind', fallback: 'label-bug', options: [label('bug'), BODY_LINE] },
        { term: 'Feature', what: 'Kind', fallback: 'label-enhancement', options: [label('enhancement'), label('feature', false), BODY_LINE] },
        { term: 'Improvement', what: 'Kind', fallback: 'label-enhancement', options: [label('enhancement'), label('improvement', false), BODY_LINE] },
      ],
      limits: [],
    },
    addition: {
      trigger: 'Refinement would mark kinds with labels in pedro/side-project.',
      question: { title: 'Add the factory’s labels to pedro/side-project?', detected: 'Missing: concept and build. bug and enhancement exist.', fallback: 'create', options: [
        { id: 'create', title: 'Create concept and build labels', cost: 'Two new labels anyone can see; filters find factory work.' },
        { id: 'not-now', title: 'Not now', cost: 'Kinds stay as a line in the body; filters can’t find them.' },
      ] },
      limits: [],
    },
  },
};

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
