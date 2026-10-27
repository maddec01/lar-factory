// The T3 project step: T3's projects, each with its provider and whether its repository has .lar-factory.json, and
// the ones that can't be picked. The Provider and item source step: the provider, then the item source, show setting
// and role, or the values of a .lar-factory.json it reuses. The Checks step: each check with its state and a failure's
// fix with Retry. The Cleanup step: each fixed Clash with its tick, Delete or Rename for a project skill named like a
// bundled skill, the Clash agent's run with its thread, Clashes or why it ended with Retry, what the PR always writes,
// and Finish for a reused .lar-factory.json. The Pull request step: the file it adds, Open the PR,
// gh's message with Retry, the wait for the merge, and Reopen PR and Start over for a PR closed without merging.

import { expect, test, vi } from 'vite-plus/test';
import type { BundledSkill, ClashRun, ClashRunState, FixedClashes, ModelGroup, ProjectChoice, SetupCheckId, SetupCheckResult } from '@lar-factory/shared';
import { $, fetchMock, mountPage, sample, settle, text, toolChecks } from '../../test/support.ts';
import { dialog, openOnboarding, project, serve } from './onboarding-support.ts';

const rows = () => [...dialog()!.querySelectorAll<HTMLElement>('[data-choice]')];
const row = (name: string) => rows().find((r) => r.dataset.choice === name)!;
const radio = (name: string) => row(name).querySelector<HTMLElement>('[role="radio"]')!;
const badges = (name: string) => [...row(name).querySelectorAll('[data-slot="badge"]')].map(text);

test('each project shows its folder, repository, provider and whether it has .lar-factory.json', async () => {
  await openOnboarding([
    project('lar-web', { hasConfig: true }),
    project('lar-cli', { hasConfig: false }),
    project('lar-ios', { hasConfig: null }),
    project('lar-api', { repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null }),
  ]);
  expect(rows().map((r) => r.dataset.choice)).toEqual(['lar-web', 'lar-cli', 'lar-ios', 'lar-api', 'new']);
  expect(text(row('lar-web'))).toContain('/Users/me/Developer/lar-web · maddec01/lar-web');
  expect(badges('lar-web')).toEqual(['GitHub', 'has .lar-factory.json']);
  expect(badges('lar-cli')).toEqual(['GitHub', 'no .lar-factory.json']);
  expect(badges('lar-ios')).toEqual(['GitHub', 'couldn’t check .lar-factory.json']);
  expect(badges('lar-api'), 'reading Azure DevOps waits for build #386').toEqual(['Azure DevOps']);
});

test("a repository already on the board, or a folder with no provider's origin, shows but can't be picked", async () => {
  await openOnboarding([
    project('lar-server', { onBoard: true }),
    project('notes', { repo: null, provider: null, hasConfig: null }),
  ]);
  expect(badges('lar-server')).toEqual(['GitHub', 'no .lar-factory.json', 'on the board']);
  expect(text(row('notes'))).toContain('Its folder is no main checkout with a GitHub or Azure DevOps origin.');
  for (const name of ['lar-server', 'notes']) {
    expect(radio(name).getAttribute('aria-disabled') ?? radio(name).hasAttribute('data-disabled').toString(), name).toBe('true');
    await settle(() => radio(name).click());
    expect(radio(name).getAttribute('aria-checked'), name).toBe('false');
  }
});

test('a repository still onboarding shows as onboarding, with its Resume to use instead', async () => {
  const data = { ...sample, repos: [], onboarding: [{ repo: 'maddec01/lar-cli', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-cli' } } }] };
  serve(data, [project('lar-cli', { onBoard: true })]);
  await mountPage(data);
  const { useWizardStore } = await import('./wizard-store.ts');
  await settle(() => useWizardStore.getState().start());
  expect(badges('lar-cli')).toEqual(['GitHub', 'no .lar-factory.json', 'onboarding']);
  expect(text(row('lar-cli'))).toContain('maddec01/lar-cli · It’s onboarding already: close this and press its Resume.');
});

test("a step that can't read T3's projects shows the problem with Retry", async () => {
  await openOnboarding({ error: "Can't read T3 Code's projects at /x" });
  const alert = dialog()!.querySelector('[role="alert"]')!;
  expect(text(alert)).toContain("Can't read T3 Code's projects at /x");
  expect(text(alert.querySelector('button')).trim()).toBe('Retry');
});

test('with no T3 project the step says so', async () => {
  await openOnboarding([]);
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('T3 Code has no project yet.');
});

test("while T3's projects are read the step shows a spinner", async () => {
  await openOnboarding([project('lar-web')]);
  fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
  const { useWizardStore } = await import('./wizard-store.ts');
  await settle(() => void useWizardStore.getState().loadProjects());
  const reading = dialog()!.querySelector('[data-reading-projects]')!;
  expect(text(reading).trim()).toBe('Reading T3 Code’s projects…');
  expect(reading.querySelector('svg.animate-spin')).not.toBeNull();
});

/** Answers Create a new T3 project's post with `body` and `status`, leaving the other requests as they were served. */
function answerCreate(body: object, status = 200): void {
  const served = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/projects' && init?.method === 'POST'
    ? new Response(JSON.stringify(body), { status }) : served(url));
}

const folderInput = () => dialog()!.querySelector<HTMLInputElement>('[data-new-folder]')!;
const addButton = () => dialog()!.querySelector<HTMLButtonElement>('[data-add-project]')!;

async function typeFolder(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(folderInput(), value);
  await settle(() => folderInput().dispatchEvent(new Event('input', { bubbles: true })));
}

test('Create a new T3 project takes a folder, adds it, and picks the new project', async () => {
  await openOnboarding([project('lar-web')]);
  expect(text(row('new'))).toContain('Create a new T3 project');
  expect(folderInput(), 'the folder shows once the choice is made').toBeNull();
  await settle(() => radio('new').click());
  expect(addButton().disabled, 'Add waits for a folder').toBe(true);
  await typeFolder('~/Developer/lar-apple');
  answerCreate({ projects: [project('lar-web'), project('lar-apple')], projectId: 'lar-apple', error: null });
  await settle(() => addButton().click());
  await settle();
  expect(radio('lar-apple').getAttribute('aria-checked')).toBe('true');
  expect(folderInput()).toBeNull();
});

test("a failing t3 project add shows t3's message and keeps the step", async () => {
  await openOnboarding([project('lar-web')]);
  await settle(() => radio('new').click());
  await typeFolder('/Users/me/lar-apple');
  answerCreate({ error: 't3 could not add the project: Could not reach the T3 Code server.' }, 502);
  await settle(() => addButton().click());
  await settle();
  const alert = dialog()!.querySelector('[role="alert"]')!;
  expect(text(alert)).toContain('t3 could not add the project: Could not reach the T3 Code server.');
  expect(folderInput().value).toBe('/Users/me/lar-apple');
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('T3 project');
});

const field = (name: string) => dialog()!.querySelector<HTMLElement>(`[data-field="${name}"]`);
const input = (name: string) => field(name)?.querySelector<HTMLInputElement>('input') ?? null;
const choice = (name: string) => dialog()!.querySelector<HTMLElement>(`[data-choice="${name}"]`)!;
const nextButton = () => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')].find((b) => text(b).trim().startsWith('Next'))!;

async function type(into: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(into, value);
  await settle(() => into.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Opens the dialog with `chosen` as the only T3 project, picks it and moves to the Provider and item source step. */
async function openSetup(chosen: ProjectChoice): Promise<void> {
  await openOnboarding([chosen]);
  await settle(() => radio(chosen.name).click());
  await settle(() => nextButton().click());
}

const suggested = () => [...dialog()!.querySelectorAll('[data-choice]')].filter((c) => text(c).includes('Suggested')).map((c) => (c as HTMLElement).dataset.choice);

test('the step shows the provider read-only, then asks the item source, show setting and role', async () => {
  await openSetup(project('lar-web'));
  expect(text(field('provider'))).toContain('GitHub');
  expect(field('provider')!.querySelector('input, [role="radio"]'), 'the provider has no control').toBeNull();
  expect(input('project-owner')!.value, "the Project's owner starts as the repository's").toBe('maddec01');
  expect(suggested()).toEqual(['all']);
  expect(nextButton().disabled).toBe(true);

  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  expect(input('project-owner'), "the repository's issues need no Project").toBeNull();
  expect(suggested()).toEqual(['opted-in']);
  expect(choice('opted-in').querySelector('[role="radio"]')!.getAttribute('aria-checked'), 'the suggestion applies').toBe('true');

  await type(input('role')!, 'Web client');
  expect(nextButton().disabled).toBe(false);
  expect(dialog()!.querySelector('[data-field="platform"], [data-field="list-group"]')).toBeNull();
});

test('while Next is disabled each answer it waits for says what it needs, under its field', async () => {
  await openSetup(project('lar-web'));
  const problem = (name: string) => text(field(name)!.querySelector('[data-problem]')) || null;
  expect([problem('project-owner'), problem('project-number'), problem('role')])
    .toEqual([null, 'Next needs the number, a positive whole number like 3.', 'Next needs the repository’s role.']);
  await type(input('project-owner')!, '-maddec01');
  await type(input('project-number')!, '3.5');
  expect(problem('project-owner')).toBe('Next needs a GitHub login: letters, digits and single hyphens, not at either end.');
  expect(problem('project-number')).toBe('Next needs the number, a positive whole number like 3.');
  await type(input('project-owner')!, 'maddec01');
  await type(input('project-number')!, '3');
  await type(input('role')!, 'Web client');
  expect(dialog()!.querySelector('[data-problem]')).toBeNull();
  expect(nextButton().disabled).toBe(false);
});

test('an answer Next waits for is muted help until its field is edited or left, then marks the field invalid', async () => {
  await openSetup(project('lar-web'));
  const invalid = (name: string) => input(name)!.getAttribute('aria-invalid') === 'true';
  const note = (name: string) => field(name)!.querySelector<HTMLElement>('[data-problem]')!;
  expect([invalid('project-number'), invalid('role')], 'nothing marked before any typing').toEqual([false, false]);
  expect(note('role').className).toContain('text-muted-foreground');
  await type(input('project-number')!, '3.5');
  expect([invalid('project-number'), invalid('role')]).toEqual([true, false]);
  expect(note('project-number').className).toContain('text-destructive-foreground');
  await settle(() => input('role')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
  expect(invalid('role'), 'left empty').toBe(true);
});

test("each field's help and problem describe its input, outside its label", async () => {
  await openSetup(project('lar-web'));
  const role = input('role')!;
  const label = role.closest('label')!;
  expect(label.querySelector('[data-problem]'), 'the problem is not part of the name').toBeNull();
  expect(text(label)).toBe('Repository role');
  const described = role.getAttribute('aria-describedby')!.split(' ').map((id) => text(document.getElementById(id)));
  expect(described).toEqual(['What this repository is to the others.', 'Next needs the repository’s role.']);
});

test('a picked show setting stays when the item source changes', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('opted-in').querySelector<HTMLElement>('[role="radio"]')!.click());
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await settle(() => choice('github-project').querySelector<HTMLElement>('[role="radio"]')!.click());
  expect(choice('opted-in').querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
  expect(suggested(), 'the suggestion is still marked').toEqual(['all']);
  await type(input('project-number')!, '3');
  await type(input('role')!, 'Web client');
  expect(nextButton().disabled).toBe(false);
});

test('a reused .lar-factory.json shows its values and asks nothing', async () => {
  await openSetup(project('lar-web', { hasConfig: true,
    config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'opted-in', role: 'Web client' } }));
  const values = text(dialog()!.querySelector('[data-reused-config]'));
  for (const value of ['GitHub', 'GitHub Project maddec01 #3', 'Opted-in items', 'Web client']) expect(values).toContain(value);
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('build #385');
  expect(dialog()!.querySelector('[data-slot="dialog-panel"] input, [data-slot="dialog-panel"] [role="radio"]')).toBeNull();
  expect(nextButton().disabled).toBe(false);
});

test("a .lar-factory.json that can't be reused shows its problem with Retry, and Next waits", async () => {
  await openSetup(project('lar-web', { hasConfig: true, configProblem: '.lar-factory.json field role is missing or not a string.' }));
  const alert = dialog()!.querySelector('[data-slot="dialog-panel"] [role="alert"]')!;
  expect(text(alert)).toContain('.lar-factory.json field role is missing or not a string.');
  expect(text(alert.querySelector('button')).trim()).toBe('Retry');
  expect(nextButton().disabled).toBe(true);
});

test('an Azure DevOps origin says Azure DevOps arrives in build #386 and offers no item source', async () => {
  await openSetup(project('lar-api', { repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null }));
  expect(text(field('provider'))).toContain('Azure DevOps');
  expect(text(dialog()!.querySelector('[data-slot="dialog-panel"]'))).toContain('build #386');
  expect(dialog()!.querySelector('[data-choice]'), 'no item source').toBeNull();
  expect(nextButton().disabled).toBe(true);
});

test('Resume shows the answers the step had when it closed', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  await settle(() => dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  const { useWizardStore } = await import('./wizard-store.ts');
  const { useBoardStore } = await import('../board/board-store.ts');
  const kept = JSON.parse(String((fetchMock.mock.calls as unknown as [string, RequestInit][])
    .find(([url]) => url === '/api/onboarding/repositories')![1].body)) as { repo: string; progress: never };
  await settle(() => useBoardStore.getState().receive({ ...sample, onboarding: [kept] }));
  await settle(() => useWizardStore.getState().resume('maddec01/lar-web'));
  expect($('[data-onboarding-dialog]')).not.toBeNull();
  expect(input('role')!.value).toBe('Web client');
  expect(choice('issues').querySelector('[role="radio"]')!.getAttribute('aria-checked')).toBe('true');
});

/** Answers the command recheck with `tools` and each setup check from `results`, passing when it isn't named. */
function answerChecks(results: Partial<Record<SetupCheckId, SetupCheckResult>> = {}, tools = toolChecks()): void {
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/recheck') return new Response(JSON.stringify({ board: { ...sample, tools }, error: null }));
    if (url === '/api/onboarding/checks') {
      const { check } = JSON.parse(String(init!.body)) as { check: SetupCheckId };
      return new Response(JSON.stringify({ result: results[check] ?? { passed: true, detail: `${check} is fine` }, error: null }));
    }
    return served(url);
  });
}

const checkRow = (id: string) => dialog()!.querySelector<HTMLElement>(`[data-check="${id}"]`)!;
const footerButton = (label: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('[data-slot="dialog-footer"] button')].find((b) => text(b).trim().startsWith(label));

/** Moves from the Provider and item source step, answered or reused, to Checks, and waits for the checks. */
async function openChecks(): Promise<void> {
  await settle(() => nextButton().click());
  await vi.waitFor(() => expect(checkRow('push').dataset.status).not.toMatch(/waiting|running/));
  await settle();
}

test('the Checks step lists the command checks, then the setup checks, each with its state', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  answerChecks({}, toolChecks({ gh: { result: 'ok', version: '2.96.1' } }));
  await openChecks();
  const ids = [...dialog()!.querySelectorAll<HTMLElement>('[data-check]')].map((r) => r.dataset.check);
  expect(ids).toEqual(['gh', 't3', 'git', 'jq', 'curl', 'checkout', 'source', 'push']);
  expect(ids.map((id) => checkRow(id!).dataset.status)).toEqual(Array(8).fill('passed'));
  expect(text(checkRow('gh'))).toContain('Signed in');
  expect(text(checkRow('source'))).toContain('source is fine');
  expect(dialog()!.querySelector('[data-slot="dialog-panel"] [role="progressbar"]')!.getAttribute('aria-label')).toBe('8 of 8 passed');
  expect(nextButton().disabled).toBe(false);
});

test('a failed check shows its problem, fix and Retry, and Next stays disabled until Retry passes', async () => {
  await openSetup(project('lar-web'));
  await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
  await type(input('role')!, 'Web client');
  answerChecks({ push: { passed: false, problem: "gh's login can't push to maddec01/lar-web.", fix: 'Get write access, or log gh in as an account that has it:', command: 'gh auth login' } },
    toolChecks({ jq: { result: 'missing', fix: 'brew install jq' } }));
  await openChecks();
  expect(checkRow('jq').dataset.status).toBe('failed');
  expect(text(checkRow('jq'))).toContain('brew install jq');
  const push = checkRow('push');
  expect(push.dataset.status).toBe('failed');
  for (const part of ["gh's login can't push to maddec01/lar-web.", 'Get write access', 'gh auth login']) expect(text(push)).toContain(part);
  expect(nextButton().disabled).toBe(true);

  answerChecks();
  await settle(() => [...push.querySelectorAll('button')].find((b) => text(b).trim() === 'Retry')!.click());
  await vi.waitFor(() => expect(checkRow('push').dataset.status).toBe('passed'));
  expect(nextButton().disabled, 'jq still fails').toBe(true);
  await settle(() => [...checkRow('jq').querySelectorAll('button')].find((b) => text(b).trim() === 'Retry')!.click());
  await vi.waitFor(() => expect(checkRow('jq').dataset.status).toBe('passed'));
  await vi.waitFor(() => expect(checkRow('push').dataset.status).toBe('passed'));
  await settle();
  expect(nextButton().disabled).toBe(false);
});

const NONE: FixedClashes = { clashes: [], skillClashes: [], projectSkills: [] };
const FOUND: FixedClashes = {
  clashes: [
    { id: 'context', file: 'CONTEXT.md', ticked: true, edit: { kind: 'rename', to: 'GLOSSARY.md' }, reason: "The factory's domain docs read GLOSSARY.md, and CONTEXT.md is its old name." },
    { id: 'scratch', file: '.scratch/', ticked: false, edit: { kind: 'delete' }, reason: '.scratch/ holds 2 files from Matt Pocock\'s local tracker.' },
  ],
  skillClashes: [{ name: 'code-review', path: '.claude/skills/code-review/' }],
  projectSkills: ['code-review', 'web-deploy'],
};
const BUNDLED: BundledSkill[] = ['code-review', 'tdd'].map((name) => ({ name, author: 'Lar', licence: 'MIT', source: `https://github.com/maddec01/lar-factory/tree/main/skills/${name}` }));

const OPUS = { instanceId: 'claudeAgent', model: 'claude-opus-4-7' };
const MODELS: ModelGroup[] = [
  { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-4-7', label: 'Opus 4.7' }, { slug: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }] },
  { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
];
const run = (n: number, state: ClashRunState): ClashRun =>
  ({ ...state, title: `Look for Clashes in maddec01/lar-web (run ${n})`, threadId: `thread-${n}`, model: OPUS, startedAt: '2026-10-21T09:50:00Z' });
/** A Clash agent run that found none, so Next goes on. */
const DONE = [run(1, { state: 'done', clashes: [] })];

/** Answers the fixed checks with `answer`, what they found or the board's problem, and the agent's runs with `runs`. */
function answerClashes(answer: FixedClashes | { error: string }, runs: ClashRun[] = DONE): void {
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/clashes'
    ? new Response(JSON.stringify('error' in answer ? answer : { ...answer, error: null }), { status: 'error' in answer ? 502 : 200 })
    : url.startsWith('/api/onboarding/clash-runs') ? new Response(JSON.stringify({ runs, error: null })) : served(url, init));
}

/**
 * Answers the setup step for `chosen` when it asks, passes Checks, and moves to Cleanup with the fixed checks answered by
 * `answer` and the agent's runs by `runs`.
 */
async function openCleanup(chosen: ProjectChoice, answer: FixedClashes | { error: string } = NONE, runs: ClashRun[] = DONE): Promise<void> {
  await openSetup(chosen);
  if (!chosen.config) {
    await settle(() => choice('issues').querySelector<HTMLElement>('[role="radio"]')!.click());
    await type(input('role')!, 'Web client');
  }
  answerChecks();
  await openChecks();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...useBoardStore.getState().data, bundledSkills: BUNDLED, modelChoices: MODELS }));
  answerClashes(answer, runs);
  await settle(() => nextButton().click());
  await settle();
}

const cleanup = () => dialog()!.querySelector<HTMLElement>('[data-cleanup-step]')!;
const clashRow = (id: string) => cleanup().querySelector<HTMLElement>(`[data-clash="${id}"]`)!;
const checkbox = (id: string) => clashRow(id).querySelector<HTMLElement>('[role="checkbox"]')!;
const skillClash = () => cleanup().querySelector<HTMLElement>('[data-skill-clash]');
const skillPick = (pick: string) => skillClash()!.querySelector<HTMLElement>(`[data-skill-pick="${pick}"] [role="radio"]`)!;

test("the Cleanup step lists each fixed Clash with its file, reason and edit, CONTEXT.md's rename ticked and .scratch/'s delete not", async () => {
  await openCleanup(project('lar-web'), { ...FOUND, skillClashes: [] });
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('Cleanup');
  expect(text(clashRow('context'))).toContain('CONTEXT.md');
  expect(text(clashRow('context'))).toContain('Rename CONTEXT.md to GLOSSARY.md');
  expect(text(clashRow('scratch'))).toContain("from Matt Pocock's local tracker");
  expect(text(clashRow('scratch'))).toContain('Delete .scratch/');
  expect([checkbox('context'), checkbox('scratch')].map((c) => c.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  await settle(() => checkbox('scratch').click());
  expect(checkbox('scratch').getAttribute('aria-checked')).toBe('true');
  const { useWizardStore } = await import('./wizard-store.ts');
  expect(useWizardStore.getState().run!.cleanup).toEqual({ ticks: { scratch: true }, skills: {} });
  expect(nextButton().disabled).toBe(false);
});

test('the Always written list names the Agent skills block, the three docs/agents/ files and .lar-factory.json', async () => {
  await openCleanup(project('lar-web'));
  const written = [...cleanup().querySelectorAll<HTMLElement>('[data-written]')];
  expect(written.map((w) => w.dataset.written)).toEqual(['## Agent skills', 'docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md', '.lar-factory.json']);
  expect(text(written[0])).toContain('In CLAUDE.md if the repository has one, else in AGENTS.md');
  expect(text(written[4])).toContain('The Repository config');
  expect(text(cleanup())).toContain('The fixed checks found no Clash.');
});

test('a project skill named like a bundled skill keeps Next disabled until Delete it, or a rename to a name no other skill has', async () => {
  await openCleanup(project('lar-web'), FOUND);
  expect(text(skillClash())).toContain('.claude/skills/code-review/');
  expect(text(skillClash())).toContain('Next needs Delete it in the PR, or Rename it.');
  expect(nextButton().disabled).toBe(true);
  await settle(() => skillPick('rename').click());
  const name = () => skillClash()!.querySelector<HTMLInputElement>('[data-field="skill-name"] input')!;
  await type(name(), 'Web Review');
  expect(text(skillClash()), 'no path from an invalid name').toContain('.claude/skills/…/');
  for (const [typed, why] of [['tdd', 'tdd is a bundled skill’s name too.'], ['web-deploy', 'Another project skill is named web-deploy.']]) {
    await type(name(), typed!);
    expect(text(skillClash()!.querySelector('[data-problem]')), typed).toBe(why);
    expect(name().getAttribute('aria-invalid'), typed).toBe('true');
    expect(nextButton().disabled, typed).toBe(true);
  }
  await type(name(), 'web-code-review');
  expect(skillClash()!.querySelector('[data-problem]')).toBeNull();
  expect(text(skillClash())).toContain('.claude/skills/web-code-review/');
  expect(nextButton().disabled).toBe(false);
  await settle(() => skillPick('delete').click());
  expect(nextButton().disabled).toBe(false);
});

test('a refused rename restored on Resume shows its problem as an error straight away', async () => {
  await openCleanup(project('lar-web'), FOUND);
  await settle(() => skillPick('rename').click());
  await type(skillClash()!.querySelector<HTMLInputElement>('[data-field="skill-name"] input')!, 'tdd');
  await settle(() => dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  const { useWizardStore } = await import('./wizard-store.ts');
  const { useBoardStore } = await import('../board/board-store.ts');
  const kept = JSON.parse(String((fetchMock.mock.calls as unknown as [string, RequestInit][])
    .findLast(([url]) => url === '/api/onboarding/repositories')![1].body)) as { repo: string; progress: never };
  await settle(() => useBoardStore.getState().receive({ ...useBoardStore.getState().data, onboarding: [kept] }));
  await settle(() => useWizardStore.getState().resume('maddec01/lar-web'));
  await settle();
  const name = skillClash()!.querySelector<HTMLInputElement>('[data-field="skill-name"] input')!;
  expect(name.value).toBe('tdd');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  expect(skillClash()!.querySelector('[data-problem]')!.className).toContain('text-destructive-foreground');
});

test('fixed checks the board can\'t run show why with Retry, and Next waits until Retry runs them', async () => {
  await openCleanup(project('lar-web'), { error: "Can't read maddec01/lar-web's default branch: HTTP 502" });
  const alert = cleanup().querySelector('[role="alert"]')!;
  expect(text(alert)).toContain("Can't read maddec01/lar-web's default branch: HTTP 502");
  expect(nextButton().disabled).toBe(true);
  answerClashes(NONE);
  await settle(() => [...alert.querySelectorAll('button')].find((b) => text(b).trim() === 'Retry')!.click());
  await settle();
  expect(cleanup().querySelector('[role="alert"]')).toBeNull();
  expect(nextButton().disabled).toBe(false);
});

const agentPart = () => cleanup().querySelector<HTMLElement>('[data-clash-agent]')!;
const agentRun = () => agentPart().querySelector<HTMLElement>('[data-agent-run]');
const threadLinks = () => [...agentPart().querySelectorAll<HTMLAnchorElement>('a[data-thread-link]')].map((a) => a.getAttribute('href'));
const select = (name: string) => agentPart().querySelector<HTMLSelectElement>(`[data-field="${name}"] select`)!;
const AGENT_CLASH = { id: 'agent-1', file: 'AGENTS.md', line: 12, reason: 'It says to push to main.', edit: { kind: 'lines' as const, remove: ['Push to main.'], add: ['Open a PR.'] }, ticked: true };

/** Serves the agent's runs from `runs`, and a post as a new running run on its model, recording each post's body. */
function agentBoard(runs: ClashRun[]): object[] {
  const posts: object[] = [];
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/onboarding/clash-runs')) return served(url, init);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { model: ClashRun['model'] };
      posts.push(body);
      runs.push({ ...run(runs.length + 1, { state: 'running', progress: null }), threadId: null, model: body.model });
    }
    return new Response(JSON.stringify({ runs, error: null }));
  });
  return posts;
}

test('the Clash agent asks for a provider and model, and Look for Clashes shows the run\'s latest message and thread until its Clashes come', async () => {
  const runs: ClashRun[] = [];
  await openCleanup(project('lar-web'), FOUND, runs);
  await settle(() => skillPick('delete').click());
  expect([select('agent-provider').value, select('agent-model').value], 'the first model T3 offers').toEqual(['claudeAgent', 'claude-opus-4-7']);
  expect(nextButton().disabled, 'Next waits for a run').toBe(true);
  const posts = agentBoard(runs);
  select('agent-provider').value = 'codex';
  await settle(() => select('agent-provider').dispatchEvent(new Event('change', { bubbles: true })));
  expect(select('agent-model').value).toBe('gpt-5.5');
  await settle(() => agentPart().querySelector<HTMLButtonElement>('[data-look-for-clashes]')!.click());
  expect(posts).toEqual([{ repo: 'maddec01/lar-web', projectId: 'lar-web', model: { instanceId: 'codex', model: 'gpt-5.5' } }]);
  expect(agentRun()!.dataset.agentRun).toBe('running');
  expect(text(agentRun())).toContain('Agent running on Codex GPT-5.5');
  expect(text(agentRun())).toContain('Waiting for the agent’s first message.');
  expect(agentRun()!.querySelector<HTMLButtonElement>('[data-thread-link]')!.disabled, 'no thread yet').toBe(true);
  expect(select('agent-model').disabled).toBe(true);
  expect(nextButton().disabled).toBe(true);

  runs[0] = { ...runs[0]!, state: 'running', progress: 'Reading AGENTS.md on origin/main', threadId: 'thread-1' } as ClashRun;
  const { AGENT_POLL_MS } = await import('./wizard-store.ts');
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS));
  expect(text(agentRun())).toContain('Reading AGENTS.md on origin/main');
  expect(threadLinks()).toEqual(['t3code://threads/sample-environment/thread-1']);

  runs[0] = { ...runs[0]!, state: 'done', clashes: [AGENT_CLASH] } as ClashRun;
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS));
  expect(text(agentRun())).toContain('Codex GPT-5.5 found 1 Clash');
  const row = agentRun()!.querySelector<HTMLElement>('[data-clash="agent-1"]')!;
  for (const part of ['AGENTS.md:12', 'It says to push to main.', '- Push to main.', '+ Open a PR.']) expect(text(row)).toContain(part);
  expect(clashRow('context'), 'beside the fixed Clashes').not.toBeNull();
  await settle(() => row.querySelector<HTMLElement>('[role="checkbox"]')!.click());
  const { useWizardStore } = await import('./wizard-store.ts');
  expect(useWizardStore.getState().run!.cleanup!.ticks).toEqual({ 'agent-1': false });
  expect(nextButton().disabled).toBe(false);
});

test.each([
  ['failed', 'The Clash agent’s run failed', "The agent's reply isn't the JSON the board asked for."],
  ['waiting', 'The Clash agent is waiting for an answer', 'Answer it in the thread.'],
  ['timed-out', 'The Clash agent’s run timed out', 'The run took longer than 15 minutes.'],
] as const)('a %s run shows why with its thread and Retry, which starts a new thread and links both', async (state, title, why) => {
  const runs = [run(1, { state, why })];
  await openCleanup(project('lar-web'), NONE, runs);
  expect(text(agentRun()!.querySelector('[data-slot="alert-title"]'))).toBe(title);
  expect(text(agentRun())).toContain(why);
  expect(threadLinks()).toEqual(['t3code://threads/sample-environment/thread-1']);
  expect(nextButton().disabled).toBe(true);
  const posts = agentBoard(runs);
  await settle(() => [...agentRun()!.querySelectorAll('button')].find((b) => text(b).trim() === 'Retry')!.click());
  expect(posts).toEqual([{ repo: 'maddec01/lar-web', projectId: 'lar-web', model: OPUS }]);
  expect(agentRun()!.dataset.agentRun).toBe('running');
  runs[1] = { ...runs[1]!, state: 'done', clashes: [], threadId: 'thread-2' } as ClashRun;
  const { AGENT_POLL_MS } = await import('./wizard-store.ts');
  await settle(() => vi.advanceTimersByTime(AGENT_POLL_MS));
  expect(text(agentRun())).toContain('The agent found no Clash.');
  expect(text(agentPart().querySelector('[data-earlier-runs]'))).toContain(`Earlier run on Claude Opus 4.7: ${state === 'timed-out' ? 'timed out' : state === 'waiting' ? 'waiting for an answer' : 'failed'}`);
  expect(threadLinks()).toEqual(['t3code://threads/sample-environment/thread-2', 't3code://threads/sample-environment/thread-1']);
  expect(nextButton().disabled).toBe(false);
});

test('with a reused .lar-factory.json, Checks goes on to Cleanup, which keeps the file and ends in Finish with no PR', async () => {
  const reused = project('lar-web', { hasConfig: true, config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', role: 'Web client' } });
  await openSetup(reused);
  answerChecks();
  await openChecks();
  expect(footerButton('Finish'), 'no Finish on Checks').toBeUndefined();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...useBoardStore.getState().data, bundledSkills: BUNDLED }));
  answerClashes(NONE);
  await settle(() => nextButton().click());
  await settle();
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('Cleanup');
  expect(footerButton('Next'), 'no Pull request step').toBeUndefined();
  expect(text(cleanup().querySelector('[data-written=".lar-factory.json"]'))).toContain('Kept as it is.');
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/finish'
    ? new Response(JSON.stringify({ board: { ...sample, onboarding: [] }, error: null })) : served(url, init));
  await settle(() => footerButton('Finish')!.click());
  await settle();
  expect(dialog()).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/onboarding/repositories'), 'a finished run is not kept as onboarding').toBe(false);
});

test("an agent Clash whose edit won't apply shows why, unticked, and can't be ticked", async () => {
  const wontApply = { ...AGENT_CLASH, id: 'agent-2', line: 30, ticked: false, wontApply: "Line 30 of AGENTS.md on the default branch doesn't have the lines this edit removes." };
  await openCleanup(project('lar-web'), NONE, [run(1, { state: 'done', clashes: [AGENT_CLASH, wontApply] })]);
  expect(text(clashRow('agent-2').querySelector('[data-wont-apply]'))).toBe(`Won’t go in the PR: ${wontApply.wontApply}`);
  expect(clashRow('agent-2').querySelector('[data-edit-preview]')!.classList.contains('opacity-60'), 'its edit dimmed').toBe(true);
  expect(clashRow('agent-1').querySelector('[data-edit-preview]')!.classList.contains('opacity-60')).toBe(false);
  expect(checkbox('agent-2').getAttribute('aria-checked')).toBe('false');
  await settle(() => checkbox('agent-2').click());
  expect(checkbox('agent-2').getAttribute('aria-checked')).toBe('false');
  const { latestRun, ticked, useWizardStore } = await import('./wizard-store.ts');
  const { run: wizardRun, agent } = useWizardStore.getState();
  const latest = latestRun(agent);
  expect(latest?.state === 'done' && latest.clashes.filter((clash) => ticked(clash, wizardRun!.cleanup)).map((clash) => clash.id)).toEqual(['agent-1']);
});

test('a done run offers Look again, on the model picked then, which starts a new run and drops the old ticks', async () => {
  const runs = [run(1, { state: 'done', clashes: [AGENT_CLASH] })];
  await openCleanup(project('lar-web'), NONE, runs);
  await settle(() => checkbox('agent-1').click());
  expect(select('agent-provider').disabled).toBe(false);
  const posts = agentBoard(runs);
  select('agent-provider').value = 'codex';
  await settle(() => select('agent-provider').dispatchEvent(new Event('change', { bubbles: true })));
  const again = agentPart().querySelector<HTMLButtonElement>('[data-look-for-clashes]')!;
  expect(text(again).trim()).toBe('Look again');
  await settle(() => again.click());
  expect(posts).toEqual([{ repo: 'maddec01/lar-web', projectId: 'lar-web', model: { instanceId: 'codex', model: 'gpt-5.5' } }]);
  expect(agentRun()!.dataset.agentRun).toBe('running');
  const { useWizardStore } = await import('./wizard-store.ts');
  expect(useWizardStore.getState().run!.cleanup!.ticks).toEqual({});
});

test("a Look again the board refuses keeps the old run's ticks, and offers only the alert's Retry to start it", async () => {
  const runs = [run(1, { state: 'done', clashes: [AGENT_CLASH] })];
  await openCleanup(project('lar-web'), NONE, runs);
  await settle(() => checkbox('agent-1').click());
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url.startsWith('/api/onboarding/clash-runs') && init?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'The board is restarting.' }), { status: 503 }) : served(url, init));
  await settle(() => agentPart().querySelector<HTMLButtonElement>('[data-look-for-clashes]')!.click());
  const { useWizardStore } = await import('./wizard-store.ts');
  expect(useWizardStore.getState().run!.cleanup!.ticks).toEqual({ 'agent-1': false });
  expect(checkbox('agent-1').getAttribute('aria-checked')).toBe('false');
  expect(text(agentPart().querySelector('[role="alert"]'))).toContain('The board is restarting.');
  expect(agentPart().querySelector('[data-look-for-clashes]'), 'Retry starts it instead').toBeNull();
  expect(button(agentPart(), 'Retry')!.disabled).toBe(false);
});

test.each(['start', 'read'] as const)("the Clash agent's Retry after a failed %s makes that call again", async (call) => {
  await openCleanup(project('lar-web'), NONE, []);
  const calls: string[] = [];
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  let failing = true;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (!url.startsWith('/api/onboarding/clash-runs')) return served(url, init);
    calls.push(init?.method === 'POST' ? 'start' : 'read');
    if (failing) return new Response(JSON.stringify({ error: 'The board is restarting.' }), { status: 503 });
    return new Response(JSON.stringify({ runs: [run(1, { state: 'running', progress: null })], error: null }));
  });
  const { useWizardStore } = await import('./wizard-store.ts');
  await settle(() => call === 'start' ? agentPart().querySelector<HTMLButtonElement>('[data-look-for-clashes]')!.click() : void useWizardStore.getState().readClashRuns());
  expect(text(agentPart().querySelector('[role="alert"]'))).toContain('The board is restarting.');
  failing = false;
  calls.length = 0;
  await settle(() => button(agentPart(), 'Retry')!.click());
  expect(calls).toEqual([call]);
  expect(agentRun()!.dataset.agentRun).toBe('running');
});

test("before the board's first read the Clash agent says it's reading T3 Code's models, not that T3 offers none", async () => {
  await openCleanup(project('lar-web'), NONE, []);
  const { useBoardStore } = await import('../board/board-store.ts');
  const data = useBoardStore.getState().data;
  await settle(() => useBoardStore.getState().receive({ ...data, modelChoices: [], fetchedAt: null, error: null }));
  expect(text(agentPart().querySelector('[data-reading-models]'))).toContain('Reading T3 Code’s models…');
  expect(text(agentPart())).not.toContain('offers no provider');
  await settle(() => useBoardStore.getState().receive({ ...data, modelChoices: [], fetchedAt: '2026-10-21T09:41:00.000Z', error: null }));
  expect(text(agentPart())).toContain('T3 Code offers no provider with a model.');
});

const PR = 'https://github.com/maddec01/lar-web/pull/14';
const prStep = () => dialog()!.querySelector<HTMLElement>('[data-pr-step]')!;
const button = (within: HTMLElement, label: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b).trim().startsWith(label));

/** Answers Open the PR with `answer`, a PR's URL or the board's problem. */
function answerPr(answer: { prUrl: string } | { error: string }): void {
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url !== '/api/onboarding/pr') return served(url, init);
    const onboarding = 'prUrl' in answer ? [{ repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web' }, prUrl: PR } }] : [];
    return new Response(JSON.stringify('prUrl' in answer ? { ...answer, board: { ...sample, tools: toolChecks(), onboarding }, error: null } : answer));
  });
}

/** Answers the setup step with the repository's issues and a role, passes Checks and Cleanup, and opens the Pull request step. */
async function openPrStep(): Promise<void> {
  await openCleanup(project('lar-web'));
  await settle(() => nextButton().click());
}

test('the Pull request step shows the branch and the .lar-factory.json it adds, then Open the PR waits for the merge', async () => {
  await openPrStep();
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe('Pull request');
  expect(text(prStep())).toContain('lar-factory/onboarding');
  expect(JSON.parse(text(prStep().querySelector('pre')))).toEqual({ version: 1, role: 'Web client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: [] });
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  expect(prStep().querySelector<HTMLAnchorElement>(`a[href="${PR}"]`)).not.toBeNull();
  expect(text(prStep())).toContain('Waiting for its merge');
  expect(footerButton('Back'), 'an open PR keeps the step').toBeUndefined();
  fetchMock.mockClear();
  await settle(() => button(prStep(), 'Check now')!.click());
  expect((fetchMock.mock.calls as unknown as [string, RequestInit][]).map(([url, init]) => [url, init.method]), 'a read now, not on the next refresh').toEqual([['/api/read', 'POST']]);
  await settle(() => footerButton('Close and wait')!.click());
  expect(dialog()).toBeNull();
});

/** Opens the PR, so the step waits for its merge. */
async function openWaiting(): Promise<void> {
  await openPrStep();
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
}

test('Check now is busy until the board reads GitHub, then says when it checked and that the PR is still open', async () => {
  await openWaiting();
  await settle(() => button(prStep(), 'Check now')!.click());
  await settle();
  const checking = button(prStep(), 'Checking')!;
  expect(checking.disabled, 'busy until the next board update').toBe(true);
  expect(checking.querySelector('svg.animate-spin')).not.toBeNull();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks(), onboarding: [ON_PR], fetchedAt: new Date(Date.now()).toISOString(), error: null }));
  expect(button(prStep(), 'Check now')!.disabled).toBe(false);
  const at = new Date(Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  expect(text(prStep())).toContain(`Checked ${at}: still open`);
});

test("a Check now the board can't run shows why with Retry", async () => {
  await openWaiting();
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/read'
    ? new Response(JSON.stringify({ error: 'The board is shutting down.' }), { status: 503 }) : served(url, init));
  await settle(() => button(prStep(), 'Check now')!.click());
  await settle();
  const alert = prStep().querySelector('[role="alert"]')!;
  expect(text(alert)).toContain('The board is shutting down.');
  expect(button(alert as HTMLElement, 'Retry')).toBeDefined();
  expect(button(prStep(), 'Check now')!.disabled).toBe(false);
});

test("a Check now whose read couldn't follow the PR shows gh's message with Retry, not that it's still open", async () => {
  await openWaiting();
  await settle(() => button(prStep(), 'Check now')!.click());
  await settle();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks(), onboarding: [{ ...ON_PR, followProblem: 'gh pr view failed: HTTP 502' }],
    fetchedAt: new Date(Date.now()).toISOString(), error: null }));
  const alert = prStep().querySelector('[role="alert"]')!;
  expect(text(alert)).toContain('gh pr view failed: HTTP 502');
  expect(button(alert as HTMLElement, 'Retry')).toBeDefined();
  expect(text(prStep())).not.toContain('still open');
});

test('a read error the board had before Check now waits for a new read, not an update that keeps it', async () => {
  await openWaiting();
  const { useBoardStore } = await import('../board/board-store.ts');
  const before = { ...useBoardStore.getState().data, error: "gh can't reach GitHub." };
  await settle(() => useBoardStore.getState().receive(before));
  await settle(() => button(prStep(), 'Check now')!.click());
  await settle();
  await settle(() => useBoardStore.getState().receive({ ...before, tools: toolChecks() }));
  expect(button(prStep(), 'Checking'), 'the same error and read time is no new read').toBeDefined();
  await settle(() => useBoardStore.getState().receive({ ...before, fetchedAt: new Date(Date.now() + 1000).toISOString() }));
  expect(text(prStep().querySelector('[role="alert"]'))).toContain("gh can't reach GitHub.");
});

test("a Check now the board can't run stops waiting for the board's read", async () => {
  await openWaiting();
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/read'
    ? new Response(JSON.stringify({ error: 'The board is shutting down.' }), { status: 503 }) : served(url, init));
  const setTimer = vi.spyOn(globalThis, 'setTimeout');
  const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
  await settle(() => button(prStep(), 'Check now')!.click());
  await settle();
  const wait = setTimer.mock.results[setTimer.mock.calls.findIndex(([, ms]) => ms === 60_000)]!.value;
  expect(clearTimer).toHaveBeenCalledWith(wait);
  setTimer.mockRestore();
  clearTimer.mockRestore();
});

test("a PR the board can't open shows gh's message with Retry, and the step stays put", async () => {
  await openPrStep();
  answerPr({ error: "Can't open maddec01/lar-web's onboarding PR: gh pr create failed: HTTP 403" });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  expect(text(prStep())).toContain('gh pr create failed: HTTP 403');
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Retry')!.click());
  await settle();
  expect(prStep().querySelector(`a[href="${PR}"]`)).not.toBeNull();
});

test('once the PR merges the step says the repository is onboarded, and Go to the board closes with nothing to keep', async () => {
  await openPrStep();
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks(), onboarding: [] }));
  expect(text(prStep())).toContain('maddec01/lar-web is onboarded');
  const bar = dialog()!.querySelector('[data-slot="dialog-header"] [data-slot="progress"]')!;
  expect([bar.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow'), text(bar.querySelector('[data-slot="progress-caption"]'))], 'the Pull request step is done too').toEqual(['5', 'Onboarded']);
  fetchMock.mockClear();
  await settle(() => footerButton('Go to the board')!.click());
  expect(dialog()).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => url === '/api/onboarding/repositories')).toBe(false);
});

const ON_PR = { repo: 'maddec01/lar-web', progress: { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web' }, prUrl: PR } };

/** Opens the PR, then has the board find it closed without merging; `reopened` answers Reopen PR. */
async function closePr(reopened: object): Promise<void> {
  await openPrStep();
  answerPr({ prUrl: PR });
  await settle(() => button(prStep(), 'Open the PR')!.click());
  await settle();
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr/reopen'
    ? new Response(JSON.stringify(reopened)) : served(url, init));
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, tools: toolChecks(), onboarding: [{ ...ON_PR, progress: { ...ON_PR.progress, prClosed: true } }] }));
}

test('a PR closed without merging says so with Reopen PR, which waits for the merge again once the board reopens it', async () => {
  await closePr({ board: { ...sample, tools: toolChecks(), onboarding: [ON_PR] }, error: null });
  expect(text(prStep().querySelector('[data-pr-closed]'))).toContain('maddec01/lar-web#14 closed without merging');
  expect(text(prStep())).not.toContain('Waiting for its merge');
  expect(text(footerButton('Close')).trim(), 'nothing to wait for').toBe('Close');
  await settle(() => button(prStep(), 'Reopen PR')!.click());
  await settle();
  expect(prStep().querySelector('[data-pr-closed]')).toBeNull();
  expect(text(prStep())).toContain('Waiting for its merge');
});

test("a Reopen PR the board refuses shows gh's message and keeps Reopen PR and Start over", async () => {
  await closePr({ error: "Can't reopen maddec01/lar-web's onboarding PR: gh pr reopen failed: HTTP 403" });
  await settle(() => button(prStep(), 'Reopen PR')!.click());
  await settle();
  expect(text(prStep().querySelector('[data-pr-closed]'))).toContain('gh pr reopen failed: HTTP 403');
  expect(button(prStep(), 'Start over')).toBeDefined();
});

test('Start over opens a new PR and waits for its merge', async () => {
  await closePr({ error: null });
  const NEXT = 'https://github.com/maddec01/lar-web/pull/15';
  const served = fetchMock.getMockImplementation()! as (url: string, init?: RequestInit) => Promise<Response>;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => url === '/api/onboarding/pr'
    ? new Response(JSON.stringify({ prUrl: NEXT, board: { ...sample, tools: toolChecks(), onboarding: [{ ...ON_PR, progress: { ...ON_PR.progress, prUrl: NEXT } }] }, error: null }))
    : served(url, init));
  await settle(() => button(prStep(), 'Start over')!.click());
  await settle();
  expect(prStep().querySelector(`a[href="${NEXT}"]`)).not.toBeNull();
  expect(text(prStep())).toContain('Waiting for its merge');
});
