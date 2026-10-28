// Settings: the modal with its section list in groups, each section's title and description over its rows, the
// Claude profiles with their switches and what a change did, the bundled skills with their last updates and install
// states, the update channel, version, the update pill's state and step, and Check now, the tool rows, the repository rows with Resume and Add repository (Edit's dialog and Reset's confirmation have their own tests), and the rows that aren't built yet. The bridge stands in for the app's preload; without it
// the profiles and updates explain that they need the board app.

import { describe, expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, answerRestart, mountPage, push, sample, settle, stubApp, text, toolChecks, updatesOff } from '../../test/support.ts';
import { clock, day, type BoardData, type BundledSkill, type CheckedTool, type OnboardingProgress, type ProfilesResult, type UpdateChannel, type UpdateState } from '@lar-factory/shared';
import type { BlockingPath } from '@lar-factory/shared/install-skills';
import { dialog, project, serve } from '../onboarding/onboarding-support.ts';
import { INSTALL_RECHECK_MS } from './settings-store.ts';

const listed: ProfilesResult = {
  profiles: [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: false }],
  installed: true,
  conflicts: [],
};

const bothTicked: ProfilesResult = { ...listed, profiles: [{ name: '.claude', ticked: true }, { name: '.claude-work', ticked: true }] };

function stubBridge(setResult: ProfilesResult = listed) {
  return stubApp({
    listProfiles: vi.fn(async () => listed),
    setProfileTick: vi.fn(async (_name: string, _ticked: boolean) => setResult),
  });
}

const settingsButton = () => $<HTMLButtonElement>('.open-settings');
const modal = () => $('[data-slot="modal-content"]');
const sections = () => $$<HTMLButtonElement>('.settings-nav button');
const section = (label: string) => sections().find((b) => text(b) === label)!;
const close = () => modal()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
const body = () => $('.settings-body')!;
const row = (id: string) => $(`.settings-row[data-row="${id}"]`)!;
const switches = () => $$<HTMLButtonElement>('.settings-body [role="switch"]');
const ticked = (box: Element) => box.getAttribute('aria-checked') === 'true';
const result = () => $('#settings-result')!;
const search = () => $<HTMLInputElement>('.settings-nav input[aria-label="Search settings"]')!;

async function type(input: HTMLInputElement, value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  await settle(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

/** Mounts the page with `data`, opens Settings and shows `label`'s section. */
async function open(label = 'Skills', data: BoardData = sample): Promise<void> {
  await mountPage(data);
  await settle(() => settingsButton()!.click());
  await settle(() => section(label).click());
  await settle(() => vi.advanceTimersByTime(50));
}

test('Settings opens from the title bar, in a browser too, as a modal over the board with the sections in groups on the left', async () => {
  await mountPage();
  expect(settingsButton()!.getAttribute('aria-label')).toBe('Settings');
  await settle(() => settingsButton()!.click());
  expect(modal()!.getAttribute('role')).toBe('dialog');
  expect($$('.settings-nav [role="group"]').map((g) => [g.getAttribute('aria-label'), [...g.querySelectorAll('button')].map(text)])).toEqual([
    ['Board', ['General', 'Appearance', 'Notifications', 'Keyboard shortcuts']],
    ['Connections', ['Repositories', 'T3 Code', 'Skills']],
    ['App', ['Updates', 'Archive', 'Diagnostics']],
  ]);
  expect(section('General').getAttribute('aria-current')).toBe('page');
  expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('General');
  expect(text(modal())).toContain('How the board refreshes, what Start may do on its own, and how the app sits on your Mac.');
  expect($$('.settings-group h3').map(text)).toEqual(['Board', 'Flow limits', 'App']);
  expect($('.title-bar')!.closest('[hidden]'), 'the board stays under it').toBeNull();
  expect($('.desk')).not.toBeNull();
});

test('choosing a section shows its title, description and controls on the right', async () => {
  await open('Notifications');
  expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Notifications');
  expect(modal()!.getAttribute('aria-label') ?? text($(`#${modal()!.getAttribute('aria-labelledby')}`))).toBe('Settings: Notifications');
  expect(text(modal())).toContain('Which changes on the board tell you, and when.');
  expect(section('Notifications').getAttribute('aria-current')).toBe('page');
  expect(section('General').getAttribute('aria-current')).toBeNull();
  expect($$('.settings-group h3').map(text)).toEqual(['Tell me when', 'Delivery']);
  expect(switches()).toHaveLength(0);
  expect(text(row('quiet'))).toContain('Not available yet');
  expect(text(body())).not.toContain('Follow Focus');
});

test('search keeps the sections whose name or a row matches, and / focuses it', async () => {
  await open('General');
  await type(search(), 'dock');
  expect(sections().map(text)).toEqual(['General']);
  await type(search(), 'claude');
  expect(sections().map(text)).toEqual(['Skills']);
  expect($$('.settings-nav [role="group"]').map((g) => g.getAttribute('aria-label')), 'a group with no match goes').toEqual(['Connections']);
  await type(search(), '');
  expect(sections()).toHaveLength(10);
  search().blur();
  await settle(() => modal()!.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(search());
});

test('a search that leaves out the open section shows the first one it keeps, and clearing it goes back', async () => {
  await open('General');
  await type(search(), 'claude');
  expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Skills');
  expect(section('Skills').getAttribute('aria-current')).toBe('page');
  await type(search(), '');
  expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('General');
  expect(section('General').getAttribute('aria-current')).toBe('page');
});

test('a search that matches nothing says so in the section list and keeps the open section on the right', async () => {
  await open('Notifications');
  await type(search(), 'zzz');
  expect(sections()).toHaveLength(0);
  expect(text($('.settings-nav [role="status"]')), 'screen readers announce it').toBe('No settings match.');
  expect(text(modal()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Notifications');
  await type(search(), '');
  expect($('.settings-nav .no-match')).toBeNull();
});

test('Close returns to the board as it was, and Settings opens again on the same section', async () => {
  await mountPage();
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  await settle(() => settingsButton()!.click());
  await settle(() => section('Diagnostics').click());
  await settle(() => close().click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(modal()).toBeNull();
  expect($('.settings-body')).toBeNull();
  expect(text($('.title-bar .scope'))).toBe('lar-apple');
  await settle(() => settingsButton()!.click());
  expect(section('Diagnostics').getAttribute('aria-current')).toBe('page');
});

test('the modal takes clicks over the title bar in the board app, rather than dragging the window', async () => {
  await open('General');
  const { noDrag } = addStylesheet();
  expect(noDrag(modal()!)).toBe(true);
  expect(noDrag($('[data-slot="modal-overlay"]')!)).toBe(true);
});

test.each([[15, '15 seconds'], [60, '1 minute'], [300, '5 minutes'], [120, '2 minutes']])('Refresh every shows the board\'s %i s as %s', async (seconds, label) => {
  await open('General', { ...sample, refreshSeconds: seconds });
  expect(text(row('refresh'))).toContain(label);
});

test('a repository colour named owner/name shows it once; one named by its name shows owner/name under it', async () => {
  await open('Appearance', { ...sample, repos: [...sample.repos, { repo: 'fabrikam/lar-server', role: 'fork', labels: [] }] });
  expect(text(row('color-maddec01/lar-server')).split('maddec01/lar-server').length - 1, 'the title and the tag, no description').toBe(2);
  expect(text(row('color-maddec01/lar-apple'))).toContain('maddec01/lar-apple');
});

test('Refresh every says the board reads each repository\'s items and .lar-factory.json', async () => {
  await open('General');
  expect(text(row('refresh'))).toContain("How often the board reads every item, and each repository's .lar-factory.json, through gh on GitHub and az on Azure DevOps. Between these reads it checks GitHub for changes every 5 seconds, for free, and reads only what changed.");
  expect(text(row('confirm-abandon'))).toContain('Abandon closes a GitHub issue as not planned, or moves an Azure DevOps work item to Removed.');
});

test('unfinished settings show availability inline without controls or fictional values', async () => {
  await open('General');
  expect(text(row('refresh'))).toContain('45 seconds');
  expect(text(row('in-flight'))).toContain('Concurrent builds');
  for (const id of ['login', 'done-window', 'in-flight', 'auto-start']) {
    expect(text(row(id))).toContain('Not available yet');
    expect(row(id).querySelector('button, input, select')).toBeNull();
  }
  expect(text(body())).not.toContain('Start holds back when the factory is full');
  await settle(() => section('Appearance').click());
  expect(text(row('scheme'))).toContain('Not available yet');
  expect(text(row('font-size'))).not.toContain('13');
  expect($$('.settings-body [role="radio"], .settings-body [role="switch"], .settings-body input')).toHaveLength(0);
  await settle(() => section('T3 Code').click());
  expect(text(body())).not.toContain('Connected');
  expect(text(row('base'))).toContain('Not available yet');
});

/** Each Settings group's title with its rows' ids. */
const groups = () => $$('.settings-group').map((g) => [text(g.querySelector('h3')), [...g.querySelectorAll('.settings-row')].map((r) => r.getAttribute('data-row'))]);

test('Repositories shows the command line tools\' logins and each repository with its provider, item source and show setting', async () => {
  const repos = [sample.repos[0]!, { ...sample.repos[1]!, items: 'issues' as const, show: 'opted-in' as const },
    { repo: 'contoso/Fabrikam/lar-api', role: 'API', items: 'azure-board' as const, team: 'Fabrikam Team', labels: [] },
    { repo: 'contoso/Fabrikam/lar-web', role: 'Web', items: 'azure-board' as const, team: 'Web Team', labels: [] }];
  await open('Repositories', { ...sample, repos });
  expect(groups()).toEqual([['Command line tools', ['gh', 'az']], ['Repositories', repos.map((r) => `repo-${r.repo}`)]]);
  expect(text(row('gh').querySelector('.tool-state')), 'nothing is checked before the first check').toBe('● Not checked');
  expect(text(row('az').querySelector('.tool-state'))).toBe('● Not checked');
  expect(text(row('az'))).not.toContain('no listed repository');
  await push({ ...sample, repos, tools: toolChecks(), toolProgress: { checking: [], skipped: ['az'] } });
  expect(text(row('gh').querySelector('.tool-state'))).toBe('● Signed in');
  expect(text(row('az').querySelector('.tool-state'))).toBe('● Not checked');
  expect(text(row('az'))).toContain('Not checked: no listed repository is on Azure DevOps.');
  expect(repos.map((r) => text(row(`repo-${r.repo}`)))).toEqual([
    `${repos[0]!.repo}GitHub · Issues · All itemsEditReset`,
    `${repos[1]!.repo}GitHub · Issues · Items with a statusEditReset`,
    'contoso/Fabrikam/lar-apiAzure DevOps · Fabrikam Team\'s backlog and current sprint · All itemsEditReset',
    'contoso/Fabrikam/lar-webAzure DevOps · Web Team\'s backlog and current sprint · All itemsEditReset',
  ]);
});

test('a repository with an open Edit PR shows it on its row, with its link, until a read finds it gone', async () => {
  const editPr = 'https://github.com/maddec01/lar-server/pull/21';
  await open('Repositories', { ...sample, repos: [{ ...sample.repos[0]!, editPr }, sample.repos[1]!] });
  const link = row(`repo-${sample.repos[0]!.repo}`).querySelector('a[data-edit-pr]')!;
  expect([text(link), link.getAttribute('href')]).toEqual(['Edit PR open', editPr]);
  expect(row(`repo-${sample.repos[1]!.repo}`).querySelector('[data-edit-pr]')).toBeNull();
  await push(sample);
  expect(row(`repo-${sample.repos[0]!.repo}`).querySelector('[data-edit-pr]')).toBeNull();
});

test('each onboarded repository has Edit and Reset, and Add repository opens the onboarding dialog over Settings', async () => {
  serve(sample, [project('lar-web')]);
  await open('Repositories', sample);
  expect($$<HTMLButtonElement>('.settings-body button').map((b) => [text(b), b.disabled])).toEqual([
    ...sample.repos.flatMap(() => [['Edit', false], ['Reset', false]]), ['Add repository', false]]);
  const add = $$<HTMLButtonElement>('.settings-body button').find((b) => text(b) === 'Add repository')!;
  // A click focuses the button it presses.
  add.focus();
  await settle(() => add.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Repository');
  expect(dialog()!.contains(document.activeElement), 'the onboarding dialog holds focus').toBe(true);
  expect(text(modal()!.querySelector('[data-slot="modal-header"] h2')), 'Settings stays under it').toBe('Repositories');
  await settle(() => dialog()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()).toBeNull();
  expect(document.activeElement, 'focus goes back to Add repository').toBe(add);
});

test("an Azure DevOps repository still onboarding names its team's sprint or backlog", async () => {
  const setup = { team: 'Fabrikam Team', show: 'all' as const, showPicked: true, role: 'API' };
  const progress = (itemSource: 'azure-board' | 'azure-board'): OnboardingProgress =>
    ({ step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-api', provider: 'Azure DevOps', setup: { ...setup, itemSource } } });
  const data: BoardData = { ...sample, onboarding: [
    { repo: 'contoso/Fabrikam%20Fiber/lar-api', progress: progress('azure-board') },
    { repo: 'contoso/Fabrikam%20Fiber/lar-web', progress: progress('azure-board') },
  ] };
  serve(data, []);
  await open('Repositories', data);
  expect(text(row('repo-contoso/Fabrikam%20Fiber/lar-api'))).toBe(
    'contoso/Fabrikam Fiber/lar-apiAzure DevOps · Fabrikam Team\'s backlog and current sprint · All items · Onboarding, stopped at ChecksResumeReset');
  expect(text(row('repo-contoso/Fabrikam%20Fiber/lar-web'))).toContain('Azure DevOps · Fabrikam Team\'s backlog and current sprint · All items');
});

test('a repository still onboarding is listed with its provider, the answers it has passed and its step, and Resume reopens the dialog there', async () => {
  const setup = { itemSource: 'issues' as const, show: 'opted-in' as const, showPicked: false, role: 'Notes app' };
  const data: BoardData = { ...sample, onboarding: [
    { repo: 'maddec01/lar-web', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-web', provider: 'GitHub', setup: { ...setup, role: '' } } } },
    { repo: 'maddec01/lar-notes', progress: { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-notes', provider: 'GitHub', setup } } },
  ] };
  serve(data, [project('lar-web', { onBoard: true })]);
  await open('Repositories', data);
  expect(groups()[1]).toEqual(['Repositories', [...sample.repos.map((r) => `repo-${r.repo}`), 'repo-maddec01/lar-web', 'repo-maddec01/lar-notes']]);
  expect(text(row('repo-maddec01/lar-web')), 'answers the step has not passed yet').toBe('maddec01/lar-webGitHub · Onboarding, stopped at Board settingsResumeReset');
  expect(text(row('repo-maddec01/lar-notes'))).toBe('maddec01/lar-notesGitHub · Issues · Items with a status · Onboarding, stopped at ChecksResumeReset');
  const pr = { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-notes', provider: 'GitHub' as const, setup }, prUrl: 'https://github.com/maddec01/lar-notes/pull/2' };
  const allItems = { ...pr, answers: { ...pr.answers, setup: { ...setup, itemSource: 'issues' as const, show: 'all' as const } } };
  await push({ ...data, onboarding: [{ repo: 'maddec01/lar-web', progress: allItems }, { repo: 'maddec01/lar-notes', progress: { ...pr, prClosed: true } }] });
  expect(text(row('repo-maddec01/lar-web'))).toContain('GitHub · Issues · All items · Onboarding, waiting for you to merge its pull request');
  expect(text(row('repo-maddec01/lar-notes'))).toContain('Onboarding, its pull request closed without merging');
  await push(data);
  await settle(() => [...row('repo-maddec01/lar-web').querySelectorAll('button')].find((b) => text(b) === 'Resume')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('Board settings');
});

const DIAGNOSED = ['d-gh', 'd-t3', 'd-git', 'd-jq', 'd-curl'];

test('Diagnostics shows every command Not checked before the first check, then OK, and az not checked', async () => {
  await open('Diagnostics');
  expect([...DIAGNOSED, 'd-az'].map((id) => text(row(id).querySelector('.tool-state')))).toEqual(Array(6).fill('● Not checked'));
  await push({ ...sample, tools: toolChecks(), toolProgress: { checking: [], skipped: ['az'] } });
  expect(DIAGNOSED.map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● OK', '● OK', '● OK', '● OK', '● OK']);
  expect(text(row('d-az').querySelector('.tool-state'))).toBe('● Not checked');
  expect(text(row('d-az'))).toContain('Not checked: no listed repository is on Azure DevOps.');
});

test('the Command line tools rows show signed out, missing or the problem found, with the fix', async () => {
  await open('Repositories', { ...sample, tools: toolChecks({ gh: { result: 'logged-out', fix: 'gh auth login' },
    az: { result: 'no-extension', version: '2.67.0', fix: 'az extension add --name azure-devops' } }) });
  expect(['gh', 'az'].map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● Signed out', '● No azure-devops extension']);
  expect(text(row('gh'))).toContain('Fix: gh auth login');
  expect(text(row('az'))).toContain('Fix: az extension add --name azure-devops');
  await push({ ...sample, tools: toolChecks({ az: { result: 'ok', version: '2.67.0' } }) });
  expect(text(row('az').querySelector('.tool-state'))).toBe('● Signed in');
  await push({ ...sample, tools: toolChecks({ az: { result: 'missing', fix: 'brew install azure-cli' } }) });
  expect(text(row('az').querySelector('.tool-state'))).toBe('● Not found');
  expect(text(row('az'))).toContain('Fix: brew install azure-cli');
});

test('Settings hides gh once the checks ran without it, as no listed repository is on GitHub', async () => {
  const { gh: _, ...withoutGh } = toolChecks({ az: { result: 'ok', version: '2.67.0' } });
  await open('Repositories', { ...sample, tools: withoutGh, toolProgress: { checking: [], skipped: ['gh'] } });
  expect(groups()[0]).toEqual(['Command line tools', ['az']]);
  await settle(() => section('Diagnostics').click());
  expect($('.settings-row[data-row="d-gh"]')).toBeNull();
  expect(text(row('d-az').querySelector('.tool-state'))).toBe('● 2.67.0');
});

test('Settings shows gh and az Checking while their checks run, though other checks landed, and never as left out', async () => {
  const landed = { git: toolChecks().git };
  const data = { ...sample, tools: landed, toolProgress: { checking: ['gh', 't3', 'jq', 'curl', 'az'] as CheckedTool[], skipped: [] } };
  await open('Repositories', data);
  expect(groups()[0]).toEqual(['Command line tools', ['gh', 'az']]);
  expect(['gh', 'az'].map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● Checking', '● Checking']);
  expect(text(row('az'))).not.toContain('no listed repository');
  await settle(() => section('Diagnostics').click());
  expect([...DIAGNOSED, 'd-az'].map((id) => text(row(id).querySelector('.tool-state'))))
    .toEqual(['● Checking', '● Checking', '● OK', '● Checking', '● Checking', '● Checking']);
  expect(text(row('d-az'))).not.toContain('no listed repository');
  await push({ ...data, tools: { ...landed, az: { result: 'ok', version: '2.67.0' } }, toolProgress: { ...data.toolProgress, checking: ['gh', 't3', 'jq', 'curl'] } });
  expect(text(row('d-az').querySelector('.tool-state'))).toBe('● 2.67.0');
});

test('Diagnostics shows az with its version or its problem and fix', async () => {
  await open('Diagnostics', { ...sample, tools: toolChecks({ az: { result: 'ok', version: '2.67.0' } }) });
  expect(text(row('d-az').querySelector('.tool-state'))).toBe('● 2.67.0');
  await push({ ...sample, tools: toolChecks({ az: { result: 'logged-out', version: '2.67.0', fix: 'az login' } }) });
  expect(text(row('d-az').querySelector('.tool-state'))).toBe('● Logged out');
  expect(text(row('d-az'))).toContain('Fix: az login');
});

test('Diagnostics shows the version each command printed', async () => {
  await open('Diagnostics', { ...sample, tools: toolChecks({ gh: { result: 'ok', version: '2.102.0' }, t3: { result: 'ok', version: '0.1.3-nightly.1' },
    git: { result: 'ok', version: '2.56.0' }, jq: { result: 'ok', version: '1.7.1' } }) });
  expect(DIAGNOSED.map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● 2.102.0', '● 0.1.3-nightly.1', '● 2.56.0', '● 1.7.1', '● OK']);
  expect(text(row('d-jq'))).toContain("lar-work's scripts read gh's answers with it.");
});

test('Diagnostics shows what the lookup found wrong with gh and t3', async () => {
  await open('Diagnostics', { ...sample, tools: toolChecks({ gh: { result: 'logged-out', fix: 'gh auth login' }, t3: { result: 'missing', override: 'T3_BIN=/nowhere/t3' } }) });
  expect(['d-gh', 'd-t3'].map((id) => text(row(id).querySelector('.tool-state')))).toEqual(['● Logged out', '● Not found']);
  expect(text(row('d-t3'))).toContain('Nothing runnable at T3_BIN=/nowhere/t3. Install T3 Code.');
  expect(text(row('d-gh'))).toContain('Fix: gh auth login');
});

test('Diagnostics shows T3 Code not running, with its fix', async () => {
  await open('Diagnostics', { ...sample, tools: toolChecks({ t3: { result: 'not-running', version: '0.1.3-nightly.1' } }) });
  expect(text(row('d-t3').querySelector('.tool-state'))).toBe('● Not running');
  expect(text(row('d-t3'))).toContain('Open T3 Code.');
});

test('Diagnostics shows a gh older than 2.94.0 with its fix', async () => {
  await open('Diagnostics', { ...sample, tools: toolChecks({ gh: { result: 'outdated', version: '2.93.1', fix: 'brew upgrade gh' } }) });
  expect(text(row('d-gh').querySelector('.tool-state'))).toBe('● 2.93.1, older than 2.94.0');
  expect(text(row('d-gh'))).toContain('Fix: brew upgrade gh');
});

test('Repositories shows a gh too old as signed in as well', async () => {
  await open('Repositories', { ...sample, tools: toolChecks({ gh: { result: 'outdated', version: '2.90.0', fix: 'brew upgrade gh' } }) });
  expect(text(row('gh').querySelector('.tool-state'))).toBe('● Signed in, 2.90.0, older than 2.94.0');
  expect(text(row('gh'))).toContain('Fix: brew upgrade gh');
});

test('Diagnostics shows a missing git, jq or curl with its fix', async () => {
  await open('Diagnostics', { ...sample, tools: toolChecks({ jq: { result: 'missing', override: 'JQ_PATH=/nowhere/jq', fix: 'brew install jq' } }) });
  expect(text(row('d-jq').querySelector('.tool-state'))).toBe('● Not found');
  expect(text(row('d-jq'))).toContain('Nothing runnable at JQ_PATH=/nowhere/jq. Fix: brew install jq');
});

test('a browser explains app-only features without fictional profiles or update values', async () => {
  await open('Skills');
  expect(switches()).toHaveLength(0);
  expect(text(body())).toContain('Only the board app links skills into Claude profiles.');
  expect(text(body())).not.toContain('~/.claude-personal');
  await settle(() => section('Updates').click());
  expect(text(body())).toContain('Only the board app updates itself.');
  expect(text(body())).not.toMatch(/Nightly|0\.1\.0|3 minutes ago/);
  expect($$('.settings-body button')).toHaveLength(0);
});

test('Skills credits each bundled skill and checklist, with a link to its source, in a browser too', async () => {
  await open('Skills', { ...sample, bundledSkills: [
    { name: 'lar-work', author: 'Lar', licence: 'MIT', source: 'https://github.com/maddec01/lar-factory/tree/main/skills/lar-work' },
    { name: 'references/security-checklist.md', author: 'Addy Osmani', licence: 'MIT', source: 'https://github.com/addyosmani/agent-skills/blob/aeac41d4d005/references/security-checklist.md' },
  ] });
  expect($$('.settings-group h3').map(text)).toContain('Bundled skills');
  const rows = ['bundled-lar-work', 'bundled-references/security-checklist.md'].map(row);
  expect(rows.map((r) => [text(r.querySelector('.font-medium')), text(r.querySelector('.text-xs'))])).toEqual([
    ['lar-work', 'Lar · MIT'], ['references/security-checklist.md', 'Addy Osmani · MIT']]);
  const link = rows[1]!.querySelector('a')!;
  expect([text(link).trim(), link.getAttribute('aria-label'), link.getAttribute('href'), link.target]).toEqual(
    ['Source', 'references/security-checklist.md source', 'https://github.com/addyosmani/agent-skills/blob/aeac41d4d005/references/security-checklist.md', '_blank']);
});

const larWork: BundledSkill = { name: 'lar-work', author: 'Lar', licence: 'MIT', source: 'https://github.com/maddec01/lar-factory/tree/main/skills/lar-work' };
const tdd: BundledSkill = { name: 'tdd', author: 'Matt Pocock', licence: 'MIT', source: 'https://github.com/mattpocock/skills/tree/5beb35b040e3/skills/engineering/tdd', date: `${new Date().getUTCFullYear()}-10-19` };
const restoredAt = '2026-10-26T09:30:00.000Z';
/** Each bundled row's state, or null for none, and its tooltip. */
const states = (...names: string[]) => names.map((name) => {
  const state = row(`bundled-${name}`).querySelector('.tool-state');
  return state && [text(state), state.closest('[title]')?.getAttribute('title') ?? null];
});

test("Skills shows each skill's install state: matching, restored with its time, or blocked", async () => {
  await open('Skills', { ...sample, bundledSkills: [
    { ...larWork, status: { state: 'matching' } }, { ...tdd, status: { state: 'restored', restoredAt } }, { ...tdd, name: 'grill', status: { state: 'blocked', paths: [{ place: 'agents', path: '/home/.agents/skills/grill' }] } },
  ] });
  expect(states('lar-work', 'tdd', 'grill')).toEqual([
    ['● Installed', 'Matches this version of Lar Factory.'],
    [`● Restored ${day(restoredAt, undefined)}, ${clock(restoredAt, undefined)}`, 'Lar Factory put back its copy, which had changed.'],
    ['● Blocked', "Blocked by a path Lar Factory didn't install: /home/.agents/skills/grill (the skill isn't installed). Move that path away to install this skill."],
  ]);
});

test("a blocked skill's row says which paths block it, where each leaves it missing and to move them away", async () => {
  const paths: BlockingPath[] = [
    { place: 'agents', path: '/home/.agents/skills/grill' }, { place: 'profile', profile: '.claude', path: '/home/.claude/skills/grill' },
    { place: 'antigravity', path: '/home/.gemini/config/skills/grill' },
  ];
  await open('Skills', { ...sample, bundledSkills: [{ ...tdd, name: 'grill', status: { state: 'blocked', paths } }, { ...tdd, status: { state: 'matching' } }] });
  expect(text(row('bundled-grill').querySelector('.text-xs'))).toBe(
    "Matt Pocock · MIT · updated 19 OctBlocked by paths Lar Factory didn't install: /home/.agents/skills/grill (the skill isn't installed), " +
    "/home/.claude/skills/grill (the skill isn't linked into ~/.claude; unticking the profile also clears it), " +
    "/home/.gemini/config/skills/grill (the skill isn't installed for Antigravity). Move each path away to install this skill.");
  expect(states('grill')[0]?.[1]).toBe(text(row('bundled-grill').querySelector('.block')));
  expect(text(row('bundled-tdd').querySelector('.text-xs'))).toBe('Matt Pocock · MIT · updated 19 Oct');
});

test('a skill only Antigravity or a profile blocks says to move the path away, or untick the profile', async () => {
  const blocked = (name: string, paths: BlockingPath[]) => ({ ...tdd, name, status: { state: 'blocked' as const, paths } });
  await open('Skills', { ...sample, bundledSkills: [
    blocked('grill', [{ place: 'antigravity', path: '/home/.gemini/config/skills/grill' }]),
    blocked('tdd', [{ place: 'profile', profile: '.claude-work', path: '/home/.claude-work/skills/tdd' }]),
  ] });
  expect(states('grill', 'tdd').map((state) => state?.[1])).toEqual([
    "Blocked by a path Lar Factory didn't install: /home/.gemini/config/skills/grill (the skill isn't installed for Antigravity). Move that path away.",
    "Blocked by a path Lar Factory didn't install: /home/.claude-work/skills/tdd (the skill isn't linked into ~/.claude-work; unticking the profile also " +
    'clears it). Move that path away, or untick the profile.',
  ]);
});

test('without a manifest, as on the Sample board, the rows show no state', async () => {
  await open('Skills', { ...sample, bundledSkills: [larWork, tdd] });
  expect(states('lar-work', 'tdd')).toEqual([null, null]);
});

test("Skills shows a Copy's Date as its last update, in a browser too", async () => {
  await open('Skills', { ...sample, bundledSkills: [larWork, tdd] });
  expect([text(row('bundled-lar-work').querySelector('.text-xs')), text(row('bundled-tdd').querySelector('.text-xs'))]).toEqual([
    'Lar · MIT', 'Matt Pocock · MIT · updated 19 Oct']);
  expect(row('bundled-tdd').querySelector('.text-xs .whitespace-nowrap')?.textContent, 'the date stays on one line').toBe('updated 19 Oct');
});

test("in the board app, a Lar skill's last update is the app's version", async () => {
  stubApp({ listProfiles: vi.fn(async () => listed), getUpdateState: vi.fn(async () => ({ ...updatesOff, currentVersion: '0.2.0' })) });
  await open('Skills', { ...sample, bundledSkills: [larWork] });
  expect(text(row('bundled-lar-work').querySelector('.text-xs'))).toBe('Lar · MIT · updated in Lar Factory 0.2.0');
});

test('a Date or restore from another year shows its year', async () => {
  const lastYear = new Date().getUTCFullYear() - 1;
  await open('Skills', { ...sample, bundledSkills: [{ ...tdd, date: `${lastYear}-10-19`, status: { state: 'restored', restoredAt: `${lastYear}-06-15T12:00:00Z` } }] });
  expect(text(row('bundled-tdd').querySelector('.text-xs'))).toBe(`Matt Pocock · MIT · updated 19 Oct ${lastYear}`);
  expect(text(row('bundled-tdd').querySelector('.tool-state'))).toMatch(new RegExp(`^● Restored 15 Jun ${lastYear}, `));
});

test('Skills has no Skill sync group', async () => {
  await open('Skills', { ...sample, bundledSkills: [larWork] });
  expect(groups().map(([title]) => title)).toEqual(['Claude profiles', 'Bundled skills']);
});

test("Skills says so in one row when it couldn't read the bundled skills", async () => {
  await open('Skills', { ...sample, bundledSkills: [] });
  const group = $$('.settings-group').find((g) => text(g.querySelector('h3')) === 'Bundled skills')!;
  expect([...group.querySelectorAll<HTMLElement>('.settings-row')].map((r) => [r.dataset.row, text(r.querySelector('.font-medium'))])).toEqual(
    [['bundled-unread', "Couldn't read the bundled skills"]]);
  expect(group.querySelector('a, button, input')).toBeNull();
});

test('Skills lists every Claude profile with its tick', async () => {
  const bridge = stubBridge();
  await open();
  expect(bridge.listProfiles).toHaveBeenCalledOnce();
  expect(switches().slice(0, 2).map((s) => [s.getAttribute('aria-label'), ticked(s)])).toEqual([['~/.claude', true], ['~/.claude-work', false]]);
  expect([result().getAttribute('role'), result().dataset.slot]).toEqual(['status', 'alert']);
});

test('ticking a profile installs it and shows the new ticks', async () => {
  const bridge = stubBridge(bothTicked);
  await open();
  await settle(() => switches()[1]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledWith('.claude-work', true);
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, true]);
  expect(result().textContent).toBe('Linked the skills and checklists into ~/.claude-work.');
  expect(result().dataset.tone).toBe('success');
});

test('focus stays on a switch while its change runs and after', async () => {
  const bridge = stubBridge();
  let finish!: (result: ProfilesResult) => void;
  bridge.setProfileTick.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  const box = switches()[1]!;
  box.focus();
  await settle(() => box.click());
  // A browser blurs a control that turns disabled; jsdom doesn't, so check it stays enabled too.
  expect(box.disabled).toBe(false);
  expect(document.activeElement).toBe(box);
  expect(box.getAttribute('aria-disabled')).toBe('true');
  await settle(() => switches()[0]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledOnce();
  await settle(() => finish(bothTicked));
  expect(document.activeElement).toBe(switches()[1]);
  expect(switches()[1]!.getAttribute('aria-disabled')).toBe('false');
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, true]);
});

test('unticking a profile removes its links', async () => {
  const bridge = stubBridge({ ...listed, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }],
    removed: { links: ['tdd'], checklists: true } });
  await open();
  await settle(() => switches()[0]!.click());
  expect(bridge.setProfileTick).toHaveBeenCalledWith('.claude', false);
  expect(ticked(switches()[0]!)).toBe(false);
  expect(result().textContent).toBe('Removed the skill links and checklists from ~/.claude.');
});

test('unticking says only what it removed', async () => {
  const bridge = stubBridge({ ...bothTicked, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: true }],
    removed: { links: ['tdd'], checklists: false } });
  bridge.listProfiles.mockResolvedValueOnce(bothTicked);
  await open();
  await settle(() => switches()[0]!.click());
  expect(result().textContent).toBe('Removed the skill links from ~/.claude.');

  bridge.setProfileTick.mockResolvedValueOnce({ ...listed, profiles: [{ name: '.claude', ticked: false }, { name: '.claude-work', ticked: false }],
    removed: { links: [], checklists: false } });
  await settle(() => switches()[1]!.click());
  expect(bridge.setProfileTick).toHaveBeenLastCalledWith('.claude-work', false);
  expect(result().textContent).toBe('Lar Factory had no skill links or checklists in ~/.claude-work to remove.');
});

test('a tick that left paths alone names each one', async () => {
  stubBridge({ ...bothTicked, conflicts: ['~/.claude-work/skills/lar-work'] });
  await open();
  await settle(() => switches()[1]!.click());
  expect(result().textContent).toContain('left these alone because Lar Factory didn\'t make them');
  expect($$('#settings-result li').map((li) => li.textContent)).toEqual(['~/.claude-work/skills/lar-work']);
  expect(result().dataset.tone).toBe('warning');
});

test('a failed tick shows its error and keeps the old ticks', async () => {
  stubBridge({ ...listed, error: 'No skills are installed in /Users/me/.agents yet' });
  await open();
  await settle(() => switches()[1]!.click());
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, false]);
  expect(result().textContent).toBe('Couldn\'t change ~/.claude-work: No skills are installed in /Users/me/.agents yet');
  expect(result().dataset.tone).toBe('error');
});

test('a profile\'s result shows under the profiles only', async () => {
  stubBridge(bothTicked);
  await open();
  await settle(() => switches()[1]!.click());
  await settle(() => section('Updates').click());
  expect(result().textContent).toBe('');
  await settle(() => section('Skills').click());
  expect(result().textContent).toBe('Linked the skills and checklists into ~/.claude-work.');
});

test('a bridge that throws shows the error', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockRejectedValueOnce(new Error('home is gone'));
  await open();
  expect($('.settings-row[data-row="profile-.claude"]')).toBeNull();
  expect(result().textContent).toBe('Couldn\'t read the Claude profiles: home is gone');
});

test('a list that fails shows its error in plain words', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ profiles: [], installed: true, conflicts: [], error: 'Couldn\'t read /Users/me/.agents/.lar-factory-install.json' });
  await open();
  expect(result().textContent).toBe('Couldn\'t read the Claude profiles: Couldn\'t read /Users/me/.agents/.lar-factory-install.json');
  expect(text(body())).not.toContain('No Claude profiles found');
});

test('Skills says Loading until the list arrives, also when opened again', async () => {
  const bridge = stubBridge();
  let finish!: (result: ProfilesResult) => void;
  bridge.listProfiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await open();
  expect(text(body())).toContain('Loading…');
  expect($('.settings-row[data-row="profile-.claude"]')).toBeNull();
  await settle(() => finish(listed));
  expect(text(body())).not.toContain('Loading…');
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, false]);

  await settle(() => close().click());
  bridge.listProfiles.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  await settle(() => settingsButton()!.click());
  expect(section('Skills').getAttribute('aria-current'), 'Settings opens on the section it showed').toBe('page');
  expect(text(body())).toContain('Loading…');
  await settle(() => finish(bothTicked));
  expect(switches().slice(0, 2).map(ticked)).toEqual([true, true]);
});

test('a home without Claude profiles says so', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ profiles: [], installed: true, conflicts: [] });
  await open();
  expect(text(body())).toContain('No Claude profiles found in ~.');
});

test('before the first install the switches show disabled with the reason', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ ...listed, installed: false });
  await open();
  expect(text(body())).toContain('Lar Factory hasn\'t installed its skills in ~/.agents yet');
  expect(switches().slice(0, 2).map((s) => s.disabled)).toEqual([true, true]);
  await settle(() => switches()[1]!.click());
  expect(bridge.setProfileTick).not.toHaveBeenCalled();
});

test('open Settings turn the switches on once the launch install finishes', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValueOnce({ ...listed, installed: false }).mockResolvedValueOnce({ ...listed, installed: false });
  await open();
  expect(text(body())).toContain('ticks every profile it finds on that first install');
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS));
  expect(switches().slice(0, 2).map((s) => s.disabled)).toEqual([true, true]);
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS));
  expect(bridge.listProfiles).toHaveBeenCalledTimes(3);
  expect(text(body())).not.toContain('hasn\'t installed');
  expect(switches().slice(0, 2).map((s) => s.disabled)).toEqual([false, false]);
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS * 2));
  expect(bridge.listProfiles).toHaveBeenCalledTimes(3);
});

test('Closing Settings stops reading the profiles', async () => {
  const bridge = stubBridge();
  bridge.listProfiles.mockResolvedValue({ ...listed, installed: false });
  await open();
  await settle(() => close().click());
  await settle(() => vi.advanceTimersByTime(INSTALL_RECHECK_MS * 3));
  expect(bridge.listProfiles).toHaveBeenCalledOnce();
});

describe('updates', () => {
  const nightly: UpdateState = {
    enabled: true, status: 'up-to-date', channel: 'nightly', currentVersion: '0.2.0-nightly.20261023.41',
    availableVersion: null, downloadedVersion: null, releaseNotes: [], omittedReleaseCount: 0, downloadPercent: null,
    checkedAt: '2026-10-23T09:00:00Z', message: null, errorContext: null, canRetry: false,
  };

  function stubChannel(start: UpdateState = nightly) {
    let push: (state: UpdateState) => void = () => {};
    const bridge = stubApp({
      listProfiles: vi.fn(async () => listed),
      getUpdateState: vi.fn(async () => start),
      onUpdateState: vi.fn((listener: (state: UpdateState) => void) => { push = listener; return () => {}; }),
      setUpdateChannel: vi.fn(async (channel: UpdateChannel) => ({ ...start, channel })),
      checkForUpdate: vi.fn(async () => ({ checked: true, state: start })),
      downloadUpdate: vi.fn(async () => ({ accepted: true, completed: false, state: start })),
      installUpdate: vi.fn(async () => ({ accepted: true, completed: false, state: start })),
      confirmRestart: answerRestart(true),
    });
    return { bridge, push: (state: UpdateState) => settle(() => push(state)) };
  }

  const radios = () => $$<HTMLButtonElement>('.settings-body [role="radio"]');
  const checked = () => radios().find((each) => each.getAttribute('aria-checked') === 'true')?.value;
  const radio = (channel: UpdateChannel) => radios().find((each) => each.value === channel)!;
  const status = () => $('#update-status')!.textContent;
  const checkNow = () => $<HTMLButtonElement>('.settings-body .check-now')!;

  test('shows the channel the app is on, nightly and latest to choose from, and the version', async () => {
    stubChannel();
    await open('Updates');
    expect($('.settings-body [role="radiogroup"]')!.getAttribute('aria-label')).toBe('Update channel');
    expect(radios().map((each) => [each.value, text(each.labels[0]!)])).toEqual([['nightly', 'Nightly'], ['latest', 'Latest']]);
    expect(checked()).toBe('nightly');
    expect(text(row('version'))).toContain('Lar Factory 0.2.0-nightly.20261023.41');
    expect(status()).toBe('Up to date on 0.2.0-nightly.20261023.41.');
  });

  test('choosing a channel switches the app to it and shows what its check found', async () => {
    const { bridge, push } = stubChannel();
    await open('Updates');
    await settle(() => radio('latest').click());
    expect(bridge.setUpdateChannel).toHaveBeenCalledWith('latest');
    expect(checked()).toBe('latest');
    await push({ ...nightly, channel: 'latest', status: 'checking' });
    expect(status()).toBe('Checking for updates…');
    expect(checkNow().disabled).toBe(true);
    await push({ ...nightly, channel: 'latest', status: 'available', availableVersion: '0.1.9-nightly.20261020.12' });
    expect(status()).toBe('0.1.9-nightly.20261020.12 is available.');
  });

  test('Check now asks the app to check', async () => {
    const { bridge } = stubChannel();
    await open('Updates');
    expect(checkNow().disabled).toBe(false);
    await settle(() => checkNow().click());
    expect(bridge.checkForUpdate).toHaveBeenCalledOnce();
  });

  test('a second choice waits until the first switch ends', async () => {
    const { bridge } = stubChannel();
    let finish!: (state: UpdateState) => void;
    bridge.setUpdateChannel.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await open('Updates');
    await settle(() => radio('latest').click());
    expect(radio('nightly').getAttribute('aria-disabled')).toBe('true');
    await settle(() => radio('nightly').click());
    expect(bridge.setUpdateChannel).toHaveBeenCalledOnce();
    await settle(() => finish({ ...nightly, channel: 'latest' }));
    expect(checked()).toBe('latest');
    expect(radio('nightly').getAttribute('aria-disabled')).toBe('false');
  });

  test('the channels are busy while an update downloads or installs, when the app would refuse a switch', async () => {
    const downloaded: UpdateState = { ...nightly, status: 'downloaded', availableVersion: '0.2.0-nightly.20261024.42', downloadedVersion: '0.2.0-nightly.20261024.42', downloadPercent: 100, canRetry: true };
    const { bridge, push } = stubChannel({ ...downloaded, status: 'downloading', downloadedVersion: null, downloadPercent: 40 });
    bridge.installUpdate = vi.fn(() => new Promise<never>(() => {}));
    bridge.confirmRestart = answerRestart(true);
    await open('Updates');
    expect(radio('latest').getAttribute('aria-disabled')).toBe('true');
    await settle(() => radio('latest').click());
    expect(bridge.setUpdateChannel).not.toHaveBeenCalled();
    expect(checked()).toBe('nightly');

    await push(downloaded);
    expect(radio('latest').getAttribute('aria-disabled')).toBe('false');
    await settle(() => $<HTMLButtonElement>('.update-button')!.click());
    expect(radio('latest').getAttribute('aria-disabled')).toBe('true');
  });

  test('a refused switch keeps the old channel and says why', async () => {
    const { bridge } = stubChannel();
    bridge.setUpdateChannel.mockRejectedValueOnce(new Error('Cannot change the update channel to latest while an update download is in progress.'));
    await open('Updates');
    await settle(() => radio('latest').click());
    expect(checked()).toBe('nightly');
    expect(result().textContent).toBe('Couldn\'t switch to latest: Cannot change the update channel to latest while an update download is in progress.');
    expect(result().dataset.tone).toBe('error');
  });

  describe('shows the update pill\'s state', () => {
    const next = '0.2.0-nightly.20261024.42';
    const available: UpdateState = { ...nightly, status: 'available', availableVersion: next };
    const action = () => $<HTMLButtonElement>('.settings-body .update-action');
    const pill = () => $('.title-bar .update-button')!;

    test('an available update says so, and Download downloads it', async () => {
      const { bridge } = stubChannel(available);
      await open('Updates');
      expect([status(), text(pill())]).toEqual([`${next} is available.`, 'Update available']);
      expect($('.settings-body .check-now')).toBeNull();
      await settle(() => action()!.click());
      expect(bridge.downloadUpdate).toHaveBeenCalledOnce();
    });

    test('a download gives its percentage, as the pill does, and Check now waits for it', async () => {
      stubChannel({ ...available, status: 'downloading', downloadPercent: 42.4 });
      await open('Updates');
      expect([status(), text(pill())]).toEqual([`Downloading ${next}… 42%`, 'Downloading 42%']);
      expect([checkNow().disabled, checkNow().title]).toEqual([true, `Downloading ${next}… 42%`]);
    });

    test('a downloaded update says so, and Restart to update asks, then installs', async () => {
      const { bridge } = stubChannel({ ...available, status: 'downloaded', downloadedVersion: next, downloadPercent: 100 });
      await open('Updates');
      expect([status(), text(pill())]).toEqual([`${next} is ready to install.`, 'Restart to update']);
      expect(text(action())).toBe('Restart to update');
      await settle(() => action()!.click());
      expect(bridge.confirmRestart).toHaveBeenCalledOnce();
      expect(bridge.installUpdate).toHaveBeenCalledOnce();
    });

    test('while it installs, both read Installing…, disabled', async () => {
      const { bridge } = stubChannel({ ...available, status: 'downloaded', downloadedVersion: next, downloadPercent: 100 });
      bridge.installUpdate.mockImplementation(() => new Promise<never>(() => {}));
      await open('Updates');
      await settle(() => action()!.click());
      expect([text(action()), action()!.disabled, text(pill())]).toEqual(['Installing…', true, 'Installing…']);
    });
  });

  test('a failed download or install says why under the version', async () => {
    // The states the app's reducers give them: the update stays available or downloaded.
    const available: UpdateState = { ...nightly, status: 'available', availableVersion: '0.2.0-nightly.20261024.42', canRetry: true };
    const { push } = stubChannel({ ...available, errorContext: 'download', message: 'net::ERR_TIMED_OUT' });
    await open('Updates');
    expect(status()).toBe('Couldn\'t download 0.2.0-nightly.20261024.42: net::ERR_TIMED_OUT');
    await push({ ...available, status: 'downloaded', downloadedVersion: available.availableVersion, errorContext: 'install', message: 'quit refused' });
    expect(status()).toBe('Couldn\'t install 0.2.0-nightly.20261024.42: quit refused');
  });

  test('an app whose updates are off says so, and Check now gives the reason', async () => {
    stubChannel({ ...nightly, enabled: false, status: 'disabled', message: 'Updates work only in the packaged app.' });
    await open('Updates');
    expect(status()).toBe('Updates work only in the packaged app.');
    expect([checkNow().disabled, checkNow().title]).toEqual([true, 'Updates work only in the packaged app.']);
  });

  test('above the missing-t3 notice, where the title bar has no update pill, the page still reads the updater', async () => {
    stubChannel();
    await open('Updates', { ...sample, tools: toolChecks({ t3: { result: 'missing' } }) });
    expect($('.update-button')).toBeNull();
    expect(checked()).toBe('nightly');
  });
});

test('Archive explains its availability without fictional items or a Restore promise', async () => {
  await open('Archive');
  expect(text(modal())).toContain('The board does not list abandoned items yet.');
  expect(text(modal())).toContain('Reopen issues on GitHub or reactivate work items in Azure DevOps.');
  expect(text(modal())).not.toMatch(/#88|#41|Restore|last 30 days/);
  expect($$('.settings-body button')).toHaveLength(0);
});

test('Diagnostics names the address serving this board', async () => {
  vi.stubGlobal('location', new URL('http://127.0.0.1:4388'));
  await open('Diagnostics');
  expect(text(row('d-server'))).toContain('http://127.0.0.1:4388');
  expect(text(row('d-server'))).not.toContain('4317');
});
