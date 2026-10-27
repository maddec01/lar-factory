// The Settings sections and their grouped rows, from the control room prototype. Most rows aren't built yet: they
// show the prototype's value, disabled. The working rows are the Claude profiles, the update channel, version and
// the update's next step or Check now, the command check rows, the gh and az logins, each repository with Edit, which opens Edit's dialog, Resume and Add repository, which open the onboarding dialog, Reset on one still onboarding, and the
// bundled skills with their authors, licences, last updates, install states and sources. In a browser the profiles
// and updates, which only the board app has, show the prototype's values, disabled with that reason.

import type { ComponentProps, ReactNode } from 'react';
import { Archive, Bell, ExternalLink, FolderGit2, Keyboard, Palette, Plug, Plus, RefreshCw, Settings2, Sparkles, Stethoscope } from 'lucide-react';
import { GH_FLOOR, blockedBy, clock, day, itemSource, repoName, shownRepo, type BoardData, type BundledSkill, type CheckedTool, type OnboardingProgress, type ToolCheck } from '@lar-factory/shared';
import type { BlockingPath, ClaudeProfile } from '@lar-factory/shared/install-skills';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RepoTag } from '../items/item-parts.tsx';
import { stoppedAt, useWizardStore } from '../onboarding/wizard-store.ts';
import { ConfigUpdateNotice } from '../repositories/config-update-notice.tsx';
import { useEditStore } from '../repositories/edit-store.ts';
import { useResetStore } from '../repositories/reset-store.ts';
import { ChannelChoice, ProfileSwitch, ProfilesNote, UpdateAction, UpdateStatus, UpdatesNote } from './app-rows.tsx';
import { type Control, ToolState, notBuilt } from './controls.tsx';
import { profilePath } from './settings-store.ts';

interface Row {
  id: string;
  title: string;
  description?: ReactNode;
  control: Control;
  /** Why a value-only control is disabled; by default, that the row isn't built yet. */
  reason?: string;
  /** Shown under the title and the control, across the row's whole width. */
  below?: ReactNode;
}
export interface Group { title: string; description?: string; rows: Row[]; footer?: ReactNode; note?: ReactNode }
export interface Page { id: string; label: string; icon: ReactNode; description: string; groups: Group[] }

export interface PagesInput {
  data: BoardData;
  /** Whether the board app's bridge is there. */
  app: boolean;
  /** The bridge's Claude profiles, null while they load. */
  profiles: ClaudeProfile[] | null;
  /** The running version, once the updater has said. */
  version: string | null;
}

const ONLY_APP_PROFILES = 'Only the board app links skills into Claude profiles';
const ONLY_APP_UPDATES = 'Only the board app updates itself';

/**
 * A command's state: the version it printed, else OK, noting scopes gh couldn't read; the problem its check found; or
 * Not checked before the first check, in sample mode, and for an az no listed repository needs.
 * A `login` row says Signed in or Signed out instead, and Signed in beside a gh too old.
 */
export function toolState(check: ToolCheck | undefined, login = false): ComponentProps<typeof ToolState> {
  if (!check) return { text: 'Not checked', tone: 'muted' };
  const unread = 'scopes' in check ? ", couldn't read scopes" : '';
  const older = (version: string) => `${version}, older than ${GH_FLOOR}`;
  switch (check.result) {
    case 'ok': return { text: `${login ? 'Signed in' : check.version || 'OK'}${unread}`, tone: 'success' };
    case 'logged-out': return { text: login ? 'Signed out' : 'Logged out', tone: 'warning' };
    case 'outdated': return { text: `${login ? 'Signed in, ' : ''}${older(check.version)}${unread}`, tone: 'warning' };
    case 'no-project-scope': return { text: `No project scope${check.upgrade && check.version ? `, ${older(check.version)}` : ''}`, tone: 'warning' };
    case 'no-extension': return { text: 'No azure-devops extension', tone: 'warning' };
    case 'not-running': return { text: 'Not running', tone: 'warning' };
    case 'missing': return { text: 'Not found', tone: 'error' };
  }
}

/** The commands Diagnostics › Tools lists, with what each does; az follows, as it goes unchecked while no listed repository needs it. */
const DIAGNOSED: [Exclude<CheckedTool, 'az'>, string][] = [
  ['gh', 'Reads the GitHub Project and its issues.'],
  ['t3', 'Starts the lar-work threads in T3 Code.'],
  ['git', 'lar-work’s agents branch, commit and push with it.'],
  ['jq', 'lar-work’s scripts read gh’s answers with it.'],
  ['curl', 'lar-work’s scripts tell the board to refresh with it.'],
];

const custom = (render: () => ReactNode): Control => ({ type: 'custom', render });

/** Why az isn't checked, once the checks ran without it; else nothing. */
function azSkipped(data: BoardData): string {
  return data.tools && !data.tools.az ? ' Not checked: no listed repository is on Azure DevOps.' : '';
}

const REFRESH_OPTIONS = ['15 seconds', '30 seconds', '45 seconds', '1 minute', '5 minutes'];

/** The board's refresh interval as the select names it, offered too when it isn't one of the select's own. */
function refreshEvery(seconds: number): Control {
  const minutes = seconds / 60;
  const value = seconds < 60 || !Number.isInteger(minutes) ? `${seconds} seconds` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return { type: 'select', options: REFRESH_OPTIONS.includes(value) ? REFRESH_OPTIONS : [...REFRESH_OPTIONS, value], value };
}

const ITEM_SOURCES = { project: 'GitHub Project', issues: 'Issues', sprint: 'Current sprint', backlog: 'Backlog' } as const;

/**
 * An item source as Settings names it, with a GitHub Project's owner and number when it has them, like `GitHub Project maddec01 #3`,
 * and a sprint's or backlog's team, like `Fabrikam Team’s current sprint`.
 */
const sourceName = (kind: keyof typeof ITEM_SOURCES, project?: { owner: string; number: number | string }, team?: string) =>
  kind === 'project' && project ? `${ITEM_SOURCES.project} ${project.owner} #${project.number}`
    : kind === 'sprint' && team ? `${team}’s current sprint` : kind === 'backlog' && team ? `${team}’s backlog` : ITEM_SOURCES[kind];
/** Settings' name for each item source the setup step offers. */
const SETUP_SOURCES = { 'github-project': 'project', issues: 'issues', 'azure-sprint': 'sprint', 'azure-backlog': 'backlog' } as const;
const SHOWN = { all: 'All items', 'opted-in': 'Opted-in items' } as const;

/**
 * A repository still onboarding: its provider, its item source and show setting once it has passed the step that asks
 * them, and the step it stopped at or its PR's wait for the merge.
 */
function onboardingDescription(progress: OnboardingProgress): string {
  const { done, answers: { provider, setup } } = progress;
  const answered = setup && done.includes('setup')
    ? [sourceName(SETUP_SOURCES[setup.itemSource], { owner: setup.projectOwner, number: setup.projectNumber }, setup.team), SHOWN[setup.show]] : [];
  return [provider, ...answered, `Onboarding, ${stoppedAt(progress)}`].filter(Boolean).join(' · ');
}

/**
 * Each repository on this Mac's list by its name: an onboarded one with its provider, item source and show setting,
 * Edit, which opens Edit's dialog, Reset, which opens Reset's confirmation, and the config update notice while it has one, one still onboarding with what it has answered, the step it stopped at, Resume and
 * Reset, which opens Reset's confirmation. Add repository opens the onboarding dialog. The board
 * reads GitHub repositories and Azure DevOps sprints.
 */
function repositoryGroup(data: BoardData): Group {
  const onboarded: Row[] = data.repos.map((r) => ({
    id: `repo-${r.repo}`, title: shownRepo(r.repo), description: <>{itemSource(r) === 'sprint' || itemSource(r) === 'backlog' ? 'Azure DevOps' : 'GitHub'} · {sourceName(itemSource(r), r.project, r.team)} · {SHOWN[r.show ?? 'all']}
      {r.editPr && <> · <a data-edit-pr className="underline" href={r.editPr} target="_blank" rel="noopener">Edit PR open</a></>}</>,
    below: <ConfigUpdateNotice repo={r} />,
    control: custom(() => <span className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => void useEditStore.getState().open(r.repo)}>Edit</Button>
      <Button variant="secondary" onClick={() => useResetStore.getState().open(r.repo)}>Reset</Button>
    </span>),
  }));
  const onboarding: Row[] = (data.onboarding ?? []).map(({ repo, progress }) => ({
    id: `repo-${repo}`, title: shownRepo(repo), description: onboardingDescription(progress),
    control: custom(() => <span className="flex items-center gap-2">
      <Button onClick={() => useWizardStore.getState().resume(repo)}>Resume</Button>
      <Button variant="secondary" onClick={() => useResetStore.getState().open(repo)}>Reset</Button>
    </span>),
  }));
  return { title: 'Repositories', description: 'Each repository’s Repository config lives in its own .lar-factory.json; this Mac keeps only the list.',
    rows: [...onboarded, ...onboarding],
    footer: <Button variant="secondary" onClick={() => useWizardStore.getState().start()}><Plus /> Add repository</Button> };
}

function profileGroup({ app, profiles }: PagesInput): Group {
  const description = 'The app links its skills and copies its checklists into each ticked profile.';
  if (!app) {
    return { title: 'Claude profiles', description, rows: ['~/.claude', '~/.claude-personal', '~/.claude-work'].map((p, i) => ({
      id: `profile-${p}`, title: p, control: { type: 'switch', value: i < 2 }, reason: ONLY_APP_PROFILES,
    })) };
  }
  return {
    title: 'Claude profiles', description, note: <ProfilesNote />,
    rows: (profiles ?? []).map(({ name }) => ({ id: `profile-${name}`, title: profilePath(name), control: custom(() => <ProfileSwitch name={name} />) })),
  };
}

/** A skill's install state, with what it means as its tooltip; nothing before an install records it. */
function InstallState({ status }: { status: BundledSkill['status'] }) {
  if (!status) return null;
  const [text, tone, title]: [string, ComponentProps<typeof ToolState>['tone'], string] =
    status.state === 'matching' ? ['Installed', 'success', 'Matches this version of Lar Factory.']
    : status.state === 'restored' ? [`Restored ${day(status.restoredAt, undefined)}, ${clock(status.restoredAt, undefined)}`, 'warning', 'Lar Factory put back its copy, which had changed.']
    : ['Blocked', 'error', `${capitalise(blockedBy(status.paths).join(''))}. ${moveAway(status.paths)}`];
  return <span title={title}><ToolState text={text} tone={tone} /></span>;
}

/**
 * What clears a blocked skill, the end of its tooltip and line: moving the paths away, which installs the skill when
 * one is in ~/.agents/skills, or, when every path is in a Claude profile, unticking the profile.
 */
function moveAway(paths: readonly BlockingPath[]): string {
  const move = `Move ${paths.length === 1 ? 'that path' : 'each path'} away`;
  if (paths.some((blocking) => blocking.place === 'agents')) return `${move} to install this skill.`;
  const profiles = new Set(paths.flatMap((blocking) => blocking.place === 'profile' ? [blocking.profile] : []));
  return paths.every((blocking) => blocking.place === 'profile') ? `${move}, or untick the ${profiles.size === 1 ? 'profile' : 'profiles'}.` : `${move}.`;
}
const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What blocks a skill, where it leaves the skill missing and what to do, as a line under its credit; nothing for a skill nothing blocks. */
function BlockedReason({ status }: { status: BundledSkill['status'] }) {
  if (status?.state !== 'blocked') return null;
  const [opening, ...rest] = blockedBy(status.paths, (path) => <code key={path} className="break-all">{path}</code>);
  return <span className="block text-(--destructive-foreground)">
    {capitalise(opening)}{rest}. {moveAway(status.paths)}
  </span>;
}

/**
 * Who wrote each skill and checklist the app bundles, under which licence, its last update, its install state and a
 * link to its source. A Copy's last update is its Date in UPSTREAM.md; Lar's own skills update with the app.
 */
function bundledGroup({ data, version }: PagesInput): Group {
  const skills = data.bundledSkills ?? [];
  // A Date is a day with no time zone, so it reads the same everywhere. Neither a date nor a version breaks across lines.
  const updated = (skill: BundledSkill) => skill.date ? <> · <span className="whitespace-nowrap">updated {day(skill.date, 'UTC')}</span></>
    : skill.author === 'Lar' && version ? <> · <span className="whitespace-nowrap">updated in Lar Factory {version}</span></> : null;
  const rows: Row[] = skills.length ? skills.map((skill) => ({
    id: `bundled-${skill.name}`, title: skill.name, description: <>{skill.author} · {skill.licence}{updated(skill)}<BlockedReason status={skill.status} /></>,
    control: custom(() => <span className="flex items-center gap-2">
      <InstallState status={skill.status} />
      <a className="inline-flex items-center gap-1 text-xs font-medium text-(--foreground) underline-offset-2 hover:underline [&_svg]:size-3.5" aria-label={`${skill.name} source`} href={skill.source} target="_blank" rel="noopener"><ExternalLink /> Source</a>
    </span>),
  })) : [{ id: 'bundled-unread', title: 'Couldn’t read the bundled skills', description: 'The board server couldn’t read the app’s bundle, so it can’t credit them here.', control: custom(() => null) }];
  return { title: 'Bundled skills', description: 'The skills and checklists the app installs, and who wrote them.', rows };
}

function updateRows({ app, version }: PagesInput): Row[] {
  const channel = { id: 'channel', title: 'Update channel', description: 'Nightly offers each Nightly Release; Latest only Stable Releases.' };
  const install: Row = { id: 'auto-install', title: 'Install when I quit', control: { type: 'switch', value: true } };
  if (!app) {
    return [
      { ...channel, control: { type: 'radio', options: ['Nightly', 'Latest'], value: 'Nightly' }, reason: ONLY_APP_UPDATES },
      { id: 'version', title: 'Lar Factory 0.1.0-nightly.42', description: 'Up to date · checked 3 minutes ago', control: { type: 'button', label: 'Check now' }, reason: ONLY_APP_UPDATES },
      install,
    ];
  }
  return [
    { ...channel, control: custom(() => <ChannelChoice />) },
    { id: 'version', title: version ? `Lar Factory ${version}` : 'Lar Factory', description: <UpdateStatus />, control: custom(() => <UpdateAction />) },
    install,
  ];
}

export function pages(input: PagesInput): Page[] {
  const { data } = input;
  const models = ['T3 default', ...data.modelChoices.flatMap((g) => g.models.map((m) => `${g.name} · ${m.label}`))];
  return [
    { id: 'general', label: 'General', icon: <Settings2 />, description: 'How the board refreshes, what Start may do on its own, and how the app sits on your Mac.', groups: [
      { title: 'Board', rows: [
        { id: 'refresh', title: 'Refresh every', description: "How often the board reads each repository's items and .lar-factory.json, through gh on GitHub and az on Azure DevOps.", control: refreshEvery(data.refreshSeconds) },
        { id: 'done-window', title: 'Done shows', description: 'Items closed within this window stay on the board.', control: { type: 'select', options: ['3 days', '7 days', '14 days', '30 days'], value: '7 days' } },
        { id: 'open-in', title: 'Open an item in', control: { type: 'radio', options: ['GitHub', 'T3 thread', 'Ask'], value: 'T3 thread' } },
        { id: 'confirm-abandon', title: 'Confirm before Abandon', description: 'Abandon closes a GitHub issue as not planned, or moves an Azure DevOps work item to Removed.', control: { type: 'switch', value: true } },
      ] },
      { title: 'Flow limits', description: 'Start holds back when the factory is full, so work lands before more starts.', rows: [
        { id: 'in-flight', title: 'In-flight limit', description: 'Builds in progress at once.', control: { type: 'number', value: 2 } },
        { id: 'needs-you-pause', title: 'Pause Start when Needs you is above', control: { type: 'number', value: 3 } },
        { id: 'auto-start', title: 'Start the next Queued item when a slot frees', description: 'Uses the default model and workspace from T3 Code settings.', control: { type: 'switch', value: false } },
      ] },
      { title: 'App', rows: [
        { id: 'login', title: 'Open at login', control: { type: 'switch', value: true } },
        { id: 'menu-bar', title: 'Show in the menu bar', description: 'A lar icon with the Needs you count; click for a quick list.', control: { type: 'switch', value: true } },
        { id: 'dock-badge', title: 'Dock badge', control: { type: 'select', options: ['Needs you count', 'In flight count', 'Off'], value: 'Needs you count' } },
        { id: 'float', title: 'Keep above T3 Code', description: 'Floats the window over T3 Code, like a palette.', control: { type: 'switch', value: false } },
        { id: 'dock-side', title: 'Dock beside T3 Code', description: 'Snaps the window to T3 Code’s edge and follows it.', control: { type: 'radio', options: ['Off', 'Left', 'Right'], value: 'Off' } },
      ] },
    ] },
    { id: 'appearance', label: 'Appearance', icon: <Palette />, description: 'The board’s theme, density and what each item shows.', groups: [
      { title: 'Theme', rows: [
        { id: 'scheme', title: 'Color scheme', control: { type: 'radio', options: ['System', 'Light', 'Dark'], value: 'System' } },
        { id: 'follow-t3', title: 'Follow T3 Code’s theme', description: 'Reads T3 Code’s theme, contrast and glass opacity, so the two windows match.', control: { type: 'switch', value: true } },
        { id: 'density', title: 'Density', control: { type: 'radio', options: ['Comfortable', 'Compact'], value: 'Comfortable' } },
        { id: 'font-size', title: 'Interface font size', control: { type: 'number', value: 13, suffix: 'px' } },
      ] },
      { title: 'Items show', rows: [
        { id: 'show-status-bar', title: 'Status bar', description: 'Ten steps from List to Done.', control: { type: 'switch', value: true } },
        { id: 'show-slices', title: 'Slice bar', control: { type: 'switch', value: true } },
        { id: 'show-stats', title: 'Agent time, tokens and cost', control: { type: 'switch', value: true } },
        { id: 'show-labels', title: 'Labels', control: { type: 'switch', value: false } },
      ] },
      { title: 'Repository colours', rows: data.repos.map((r) => ({ id: `color-${r.repo}`, title: repoName(r.repo, data.repos),
        // A title that already is owner/name needs no line repeating it.
        description: repoName(r.repo, data.repos) === r.repo ? undefined : r.repo, control: custom(() => <RepoTag repo={r.repo} repos={data.repos} />) })) },
    ] },
    { id: 'repos', label: 'Repositories', icon: <FolderGit2 />, description: 'The repositories the board reads, and the command line logins it reads them through.', groups: [
      { title: 'Command line tools', description: 'The board reads each provider through your own login and never stores a token.', rows: [
        { id: 'gh', title: 'GitHub CLI', description: toolDescription('gh, for repositories on GitHub.', data.tools?.gh),
          control: custom(() => <ToolState {...toolState(data.tools?.gh, true)} />) },
        { id: 'az', title: 'Azure CLI', description: toolDescription(`az with the azure-devops extension, for repositories on Azure DevOps.${azSkipped(data)}`, data.tools?.az),
          control: custom(() => <ToolState {...toolState(data.tools?.az, true)} />) },
      ] },
      repositoryGroup(data),
    ] },
    { id: 't3', label: 'T3 Code', icon: <Plug />, description: 'How the board reads T3 Code, and what Start opens there.', groups: [
      { title: 'Connection', rows: [
        { id: 't3-app', title: 'T3 Code (Nightly)', description: '~/.t3/userdata · read for thread stats and the model list', control: { type: 'status', text: 'Connected', tone: 'success' } },
        { id: 't3-stats', title: 'Read thread stats', description: 'Agent time, tokens and cost on each item.', control: { type: 'switch', value: true } },
      ] },
      { title: 'Start', description: 'What Start does when it opens a lar-work thread.', rows: [
        { id: 'model', title: 'Default model', control: { type: 'select', options: models, value: 'T3 default' } },
        { id: 'workspace', title: 'Workspace', control: { type: 'radio', options: ['New worktree', 'Local checkout'], value: 'New worktree' } },
        { id: 'base', title: 'Base branch', control: { type: 'text', value: 'main', mono: true } },
        { id: 'title', title: 'Thread title', control: { type: 'text', value: '{ref} {title}', mono: true } },
        { id: 'switch-after', title: 'Switch to T3 Code after Start', control: { type: 'switch', value: true } },
      ] },
    ] },
    { id: 'skills', label: 'Skills', icon: <Sparkles />, description: 'The skills and checklists Lar Factory installs, and the Claude profiles that get them.', groups: [
      profileGroup(input),
      bundledGroup(input),
    ] },
    { id: 'notifications', label: 'Notifications', icon: <Bell />, description: 'Which changes on the board tell you, and when.', groups: [
      { title: 'Tell me when', rows: [
        { id: 'n-needs-you', title: 'An item needs me', control: { type: 'switch', value: true } },
        { id: 'n-verify', title: 'A build is ready to verify', control: { type: 'switch', value: true } },
        { id: 'n-merge', title: 'A PR is ready to merge', control: { type: 'switch', value: true } },
        { id: 'n-checks', title: 'Checks fail or run over 30 minutes', control: { type: 'switch', value: true } },
        { id: 'n-blocked', title: 'A slice gets blocked', control: { type: 'switch', value: false } },
        { id: 'n-stale', title: 'The board can’t refresh', control: { type: 'switch', value: false } },
      ] },
      { title: 'Delivery', rows: [
        { id: 'quiet', title: 'Quiet hours', control: { type: 'select', options: ['Off', '22:00 – 08:00', 'Follow Focus'], value: 'Follow Focus' } },
        { id: 'sound', title: 'Sound', control: { type: 'select', options: ['None', 'Glass', 'Tink', 'Pop'], value: 'Glass' } },
      ] },
    ] },
    { id: 'keybindings', label: 'Keybindings', icon: <Keyboard />, description: 'The board’s keyboard shortcuts.', groups: [
      { title: 'Keybindings', rows: ([
        ['Add item', ['⌘', 'N']], ['Search items', ['⌘', 'K']], ['Refresh', ['⌘', 'R']], ['Next item', ['J']], ['Previous item', ['K']],
        ['Start in T3 Code', ['⌘', '↵']], ['Queue', ['Q']], ['Open on GitHub', ['⌘', 'O']], ['Switch to T3 Code', ['⌘', '⇧', 'T']], ['Settings', ['⌘', ',']],
      ] as [string, string[]][]).map(([t, k]) => ({ id: `kb-${t}`, title: t, control: { type: 'kbd', keys: k } })) },
    ] },
    { id: 'updates', label: 'Updates', icon: <RefreshCw />, description: 'Which Releases Lar Factory offers, and when it installs them.', groups: [
      { title: 'Updates', rows: updateRows(input), ...(input.app && { note: <UpdatesNote /> }) },
    ] },
    { id: 'archive', label: 'Archive', icon: <Archive />, description: 'Items abandoned from the board, which you can restore.', groups: [
      { title: 'Abandoned', description: 'Items closed as not planned from the board, last 30 days.', rows: [
        { id: 'ab-1', title: '#88 Bonjour discovery fallback', description: 'Server · abandoned 4 days ago', control: { type: 'button', label: 'Restore' }, reason: notBuilt('Restore') },
        { id: 'ab-2', title: '#41 Picture-in-picture on iPad', description: 'Apple · abandoned 12 days ago', control: { type: 'button', label: 'Restore' }, reason: notBuilt('Restore') },
      ] },
    ] },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Stethoscope />, description: 'The commands the board runs, and its server.', groups: [
      { title: 'Tools', rows: [
        ...DIAGNOSED.map(([name, does]): Row => ({
          id: `d-${name}`, title: name, description: toolDescription(does, data.tools?.[name]), control: custom(() => <ToolState {...toolState(data.tools?.[name])} />),
        })),
        { id: 'd-az', title: 'az', description: toolDescription(`Reads repositories on Azure DevOps.${azSkipped(data)}`, data.tools?.az),
          control: custom(() => <ToolState {...toolState(data.tools?.az)} />) },
        { id: 'd-server', title: 'Board server', description: `127.0.0.1:4317 · last read ${data.fetchedAt ? 'OK' : 'never'}`, control: { type: 'button', label: 'Open logs' }, reason: notBuilt('Open logs') },
      ] },
    ] },
  ];
}

/** What the command does, or why its check failed and how to fix it. */
export function toolDescription(does: string, check: ToolCheck | undefined): ReactNode {
  if (!check || check.result === 'ok') return does;
  if (check.result === 'not-running') return 'Open T3 Code.';
  const where = check.result === 'missing' && check.override ? `Nothing runnable at ${check.override}. ` : '';
  if (!('fix' in check)) return `${where}Install T3 Code.`;
  const upgrade = check.result === 'no-project-scope' && check.upgrade;
  return <>{where}Fix: <code className="whitespace-nowrap">{check.fix}</code>{upgrade && <>, then <code className="whitespace-nowrap">{upgrade}</code></>}</>;
}
