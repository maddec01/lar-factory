// Settings shows working controls and real read-only values. Unbuilt controls show their availability inline.

import { useState, type ComponentProps, type ReactNode } from 'react';
import { DIALOG_PREFERENCES, dialogPreference } from '../expand-dialog/expand-dialog.tsx';
import { Archive, Bell, ExternalLink, FolderGit2, Keyboard, Palette, Plug, RefreshCw, Settings2, Sparkles, Stethoscope } from 'lucide-react';
import { GH_FLOOR, blockedBy, clock, day, itemSource, repoName, shownRepo, type BoardData, type BundledSkill, type CheckedTool, type OnboardingProgress, type ToolCheck } from '@lar-factory/shared';
import type { BlockingPath, ClaudeProfile } from '@lar-factory/shared/install-skills';
import { Button } from '@lar-factory/ui/design-system/Button';
import { RepoTag } from '../items/item-parts.tsx';
import { stoppedAt, useWizardStore } from '../onboarding/wizard-store.ts';
import { ConfigUpdateNotice } from '../repositories/config-update-notice.tsx';
import { useEditStore } from '../repositories/edit-store.ts';
import { useResetStore } from '../repositories/reset-store.ts';
import { ChannelChoice, ProfileSwitch, ProfilesNote, UpdateAction, UpdateStatus, UpdatesNote } from './app-rows.tsx';
import { Switch, type Control, ToolState } from './controls.tsx';
import { profilePath } from './settings-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

function DialogPreference({ preference, label }: { preference: keyof typeof DIALOG_PREFERENCES; label: string }) {
  const [on, setOn] = useState(() => dialogPreference(preference));
  return <Switch label={label} on={on} onChange={(next) => {
    localStorage.setItem(DIALOG_PREFERENCES[preference], next ? '1' : '0');
    setOn(next);
  }} />;
}

interface Row {
  id: string;
  title: string;
  description?: ReactNode;
  control: Control;
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

const ONLY_APP_PROFILES = 'Only the board app links skills into Claude profiles.';
const ONLY_APP_UPDATES = 'Only the board app updates itself.';

/**
 * A command's state: the version it printed, else OK, noting scopes gh couldn't read; the problem its check found; or
 * Not checked before the first check, in sample mode, and for an az no listed repository needs.
 * A `login` row says Signed in or Signed out instead, and Signed in beside a gh too old.
 */
export function toolState(check: ToolCheck | undefined, login = false): ComponentProps<typeof ToolState> {
  if (!check) return { text: 'Not checked', tone: 'muted' };
  const older = (version: string) => `${version}, older than ${GH_FLOOR}`;
  switch (check.result) {
    case 'ok': return { text: `${login ? 'Signed in' : check.version || 'OK'}`, tone: 'success' };
    case 'logged-out': return { text: login ? 'Signed out' : 'Logged out', tone: 'warning' };
    case 'outdated': return { text: `${login ? 'Signed in, ' : ''}${older(check.version)}`, tone: 'warning' };
    case 'no-extension': return { text: 'No azure-devops extension', tone: 'warning' };
    case 'not-running': return { text: 'Not running', tone: 'warning' };
    case 'missing': return { text: 'Not found', tone: 'error' };
  }
}

/** The commands Diagnostics › Tools lists, with what each does; az follows, as it goes unchecked while no listed repository needs it. */
const DIAGNOSED: [Exclude<CheckedTool, 'az'>, string][] = [
  ['gh', 'Reads GitHub repository issues and linked pull requests.'],
  ['t3', 'Starts the lar-work threads in T3 Code.'],
  ['git', "lar-work's agents branch, commit and push with it."],
  ['jq', "lar-work's scripts read gh's answers with it."],
  ['curl', "lar-work's scripts tell the board to refresh with it."],
];

const custom = (render: () => ReactNode): Control => ({ type: 'custom', render });

/** Whether the check leaves gh out, as no listed repository is on GitHub; Settings then leaves gh out. */
const ghSkipped = (data: BoardData): boolean => !!data.toolProgress?.skipped.includes('gh');

/** Why az isn't checked, once the check leaves it out; else nothing. */
function azSkipped(data: BoardData): string {
  return data.toolProgress?.skipped.includes('az') ? ' Not checked: no listed repository is on Azure DevOps.' : '';
}

/** `name`'s state in `data`, Checking while its check runs with no result yet. */
function stateOf(data: BoardData, name: CheckedTool, login = false): ComponentProps<typeof ToolState> {
  const check = data.tools?.[name];
  if (!check && data.toolProgress?.checking.includes(name)) return { text: 'Checking', tone: 'muted' };
  return toolState(check, login);
}

/** The board's current refresh interval, read-only. */
function refreshEvery(seconds: number): Control {
  const minutes = seconds / 60;
  const value = seconds < 60 || !Number.isInteger(minutes) ? `${seconds} seconds` : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  return custom(() => <span className="text-xs text-(--muted-foreground)">{value}</span>);
}

const ITEM_SOURCES = { issues: 'Issues', 'azure-board': 'Backlog and current sprint' } as const;
const sourceName = (kind: keyof typeof ITEM_SOURCES, team?: string) =>
  kind === 'azure-board' && team ? `${team}'s backlog and current sprint` : ITEM_SOURCES[kind];

const SHOWN = { all: 'All items', 'opted-in': 'Items with a status' } as const;

/**
 * A repository still onboarding: its provider, its item source and show setting once it has passed the step that asks
 * them, and the step it stopped at or its PR's wait for the merge.
 */
function onboardingDescription(progress: OnboardingProgress): string {
  const { done, answers: { provider, setup } } = progress;
  const answered = setup && done.includes('setup')
    ? [sourceName(setup.itemSource, setup.team), SHOWN[setup.show]] : [];
  return [provider, ...answered, `Onboarding, ${stoppedAt(progress)}`].filter(Boolean).join(' · ');
}

/**
 * Each repository on this Mac's list by its name: an onboarded one with its provider, item source and show setting,
 * Edit, which opens Edit's dialog, Reset, which opens Reset's confirmation, and the config update notice while it has one, one still onboarding with what it has answered, the step it stopped at, Resume and
 * Reset, which opens Reset's confirmation, and one resetting with its PR until it merges or closes. Add repository opens the onboarding dialog. The board
 * reads GitHub repositories and Azure DevOps sprints.
 */
function repositoryGroup(data: BoardData): Group {
  const onboarded: Row[] = data.repos.map((r) => ({
    id: `repo-${r.repo}`, title: shownRepo(r.repo), description: <>{itemSource(r) === 'azure-board' ? 'Azure DevOps' : 'GitHub'} · {sourceName(itemSource(r), r.team)} · {SHOWN[r.show ?? 'all']}
      {r.editPr && <> · <a data-edit-pr className="underline" href={r.editPr} target="_blank" rel="noopener">Edit PR open</a></>}</>,
    below: <ConfigUpdateNotice repo={r} />,
    control: custom(() => <span className="flex items-center gap-2">
      <Button {...kind('other')} onClick={() => void useEditStore.getState().open(r.repo)}>Edit</Button>
      <Button {...kind('other')} onClick={() => useResetStore.getState().open(r.repo)}>Reset</Button>
    </span>),
  }));
  const onboarding: Row[] = (data.onboarding ?? []).map(({ repo, progress }) => ({
    id: `repo-${repo}`, title: shownRepo(repo), description: onboardingDescription(progress),
    control: custom(() => <span className="flex items-center gap-2">
      <Button {...kind('other')} onClick={() => useWizardStore.getState().resume(repo)}>Resume</Button>
      <Button {...kind('other')} onClick={() => useResetStore.getState().open(repo)}>Reset</Button>
    </span>),
  }));
  const resetting: Row[] = (data.resetting ?? []).map(({ repo, prUrl }) => ({
    id: `repo-${repo}`, title: shownRepo(repo), description: 'Resetting. Merge the PR to finish.',
    control: custom(() => <a className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline" href={prUrl} target="_blank" rel="noopener"><ExternalLink className="size-3.5" />Open PR</a>),
  }));
  return { title: 'Repositories', description: "Each repository's Repository config lives in its own .lar-factory.json; this Mac keeps only the list.",
    rows: [...onboarded, ...onboarding, ...resetting],
    footer: <Button {...kind('other')} onClick={() => useWizardStore.getState().start()}>Add repository</Button> };
}

function profileGroup({ app, profiles }: PagesInput): Group {
  const description = 'The app links its skills and copies its checklists into each ticked profile.';
  if (!app) return { title: 'Claude profiles', description: ONLY_APP_PROFILES, rows: [] };
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
  })) : [{ id: 'bundled-unread', title: "Couldn't read the bundled skills", description: "The board server couldn't read the app's bundle, so it can't credit them here.", control: custom(() => null) }];
  return { title: 'Bundled skills', description: 'The skills and checklists the app installs, and who wrote them.', rows };
}

function updateRows({ app, version }: PagesInput): Row[] {
  const channel = { id: 'channel', title: 'Update channel', description: 'Nightly offers each Nightly Release; Latest only Stable Releases.' };
  if (!app) return [{ id: 'updates-app-only', title: ONLY_APP_UPDATES, control: custom(() => null) }];
  return [
    { ...channel, control: custom(() => <ChannelChoice />) },
    { id: 'version', title: version ? `Lar Factory ${version}` : 'Lar Factory', description: <UpdateStatus />, control: custom(() => <UpdateAction />) },
  ];
}

export function pages(input: PagesInput): Page[] {
  const { data } = input;
  return [
    { id: 'general', label: 'General', icon: <Settings2 />, description: 'How the board refreshes, what Start may do on its own, and how the app sits on your Mac.', groups: [
      { title: 'Board', rows: [
        { id: 'refresh', title: 'Refresh every', description: "How often the board reads every item, and each repository's .lar-factory.json, through gh on GitHub and az on Azure DevOps. Between these reads it checks GitHub for changes every 5 seconds, for free, and reads only what changed.", control: refreshEvery(data.refreshSeconds) },
        { id: 'done-window', title: 'Done shows', control: { type: 'unavailable' } },
        { id: 'open-in', title: 'Open an item in', control: { type: 'unavailable' } },
        { id: 'confirm-abandon', title: 'Confirm before Abandon', description: 'Abandon closes a GitHub issue as not planned, or moves an Azure DevOps work item to Removed.', control: custom(() => <span className="text-xs text-(--muted-foreground)">Always ask</span>) },
      ] },
      { title: 'Flow limits', rows: [
        { id: 'in-flight', title: 'Concurrent builds', control: { type: 'unavailable' } },
        { id: 'needs-you-pause', title: 'Pause Start when Needs you is above', control: { type: 'unavailable' } },
        { id: 'auto-start', title: 'Start the next Queued item when a slot frees', control: { type: 'unavailable' } },
      ] },
      { title: 'App', rows: [
        { id: 'login', title: 'Open at login', control: { type: 'unavailable' } },
        { id: 'menu-bar', title: 'Show in the menu bar', control: { type: 'unavailable' } },
        { id: 'dock-badge', title: 'Dock badge', control: { type: 'unavailable' } },
        { id: 'float', title: 'Keep above T3 Code', control: { type: 'unavailable' } },
        { id: 'dock-side', title: 'Dock beside T3 Code', control: { type: 'unavailable' } },
      ] },
    ] },
    { id: 'appearance', label: 'Appearance', icon: <Palette />, description: "The board's theme, density and what each item shows.", groups: [
      { title: 'Dialogs', rows: [
        { id: 'match-list-size', title: 'Match List size when opening Item or Add item', control: custom(() => <DialogPreference preference="matchList" label="Match List size when opening Item or Add item" />) },
        { id: 'open-list-expanded', title: 'Open List expanded', control: custom(() => <DialogPreference preference="openList" label="Open List expanded" />) },
      ] },
      { title: 'Theme', rows: [
        { id: 'scheme', title: 'Color scheme', control: { type: 'unavailable' } },
        { id: 'follow-t3', title: "Follow T3 Code's theme", control: { type: 'unavailable' } },
        { id: 'density', title: 'Density', control: { type: 'unavailable' } },
        { id: 'font-size', title: 'Interface font size', control: { type: 'unavailable' } },
      ] },
      { title: 'Items show', rows: [
        { id: 'show-status-bar', title: 'Status bar', control: { type: 'unavailable' } },
        { id: 'show-slices', title: 'Slice bar', control: { type: 'unavailable' } },
        { id: 'show-stats', title: 'Agent time, tokens and cost', control: { type: 'unavailable' } },
        { id: 'show-labels', title: 'Labels', control: { type: 'unavailable' } },
      ] },
      { title: 'Repository colours', rows: data.repos.map((r) => ({ id: `color-${r.repo}`, title: repoName(r.repo, data.repos),
        // A title that already is owner/name needs no line repeating it.
        description: repoName(r.repo, data.repos) === r.repo ? undefined : r.repo, control: custom(() => <RepoTag repo={r.repo} repos={data.repos} />) })) },
    ] },
    { id: 'repos', label: 'Repositories', icon: <FolderGit2 />, description: 'The repositories the board reads, and the command line logins it reads them through.', groups: [
      { title: 'Command line tools', description: 'The board reads each provider through your own login and never stores a token.', rows: [
        ...ghSkipped(data) ? [] : [{ id: 'gh', title: 'GitHub CLI', description: toolDescription('gh, for repositories on GitHub.', data.tools?.gh),
          control: custom(() => <ToolState {...stateOf(data, 'gh', true)} />) }],
        { id: 'az', title: 'Azure CLI', description: toolDescription(`az with the azure-devops extension, for repositories on Azure DevOps.${azSkipped(data)}`, data.tools?.az),
          control: custom(() => <ToolState {...stateOf(data, 'az', true)} />) },
      ] },
      repositoryGroup(data),
    ] },
    { id: 't3', label: 'T3 Code', icon: <Plug />, description: 'How the board reads T3 Code, and what Start opens there.', groups: [
      { title: 'Connection', rows: [
        { id: 't3-app', title: 'T3 Code', control: { type: 'unavailable' } },
        { id: 't3-stats', title: 'Read thread stats', control: { type: 'unavailable' } },
      ] },
      { title: 'Start', description: 'What Start does when it opens a lar-work thread.', rows: [
        { id: 'model', title: 'Default model', control: { type: 'unavailable' } },
        { id: 'workspace', title: 'Workspace', control: { type: 'unavailable' } },
        { id: 'base', title: 'Base branch', control: { type: 'unavailable' } },
        { id: 'title', title: 'Thread title', control: { type: 'unavailable' } },
        { id: 'switch-after', title: 'Switch to T3 Code after Start', control: { type: 'unavailable' } },
      ] },
    ] },
    { id: 'skills', label: 'Skills', icon: <Sparkles />, description: 'The skills and checklists Lar Factory installs, and the Claude profiles that get them.', groups: [
      profileGroup(input),
      bundledGroup(input),
    ] },
    { id: 'notifications', label: 'Notifications', icon: <Bell />, description: 'Which changes on the board tell you, and when.', groups: [
      { title: 'Tell me when', rows: [
        { id: 'n-needs-you', title: 'An item needs me', control: { type: 'unavailable' } },
        { id: 'n-verify', title: 'A build is ready to verify', control: { type: 'unavailable' } },
        { id: 'n-merge', title: 'A PR is ready to merge', control: { type: 'unavailable' } },
        { id: 'n-checks', title: 'Checks fail or run over 30 minutes', control: { type: 'unavailable' } },
        { id: 'n-blocked', title: 'A slice gets blocked', control: { type: 'unavailable' } },
        { id: 'n-stale', title: "The board can't refresh", control: { type: 'unavailable' } },
      ] },
      { title: 'Delivery', rows: [
        { id: 'quiet', title: 'Quiet hours', control: { type: 'unavailable' } },
        { id: 'sound', title: 'Sound', control: { type: 'unavailable' } },
      ] },
    ] },
    { id: 'keybindings', label: 'Keyboard shortcuts', icon: <Keyboard />, description: "The board's keyboard shortcuts.", groups: [
      { title: 'Keyboard shortcuts', description: 'Keyboard shortcut settings are not available yet.', rows: [] },
    ] },
    { id: 'updates', label: 'Updates', icon: <RefreshCw />, description: 'Which Releases Lar Factory offers, and when it installs them.', groups: [
      { title: 'Updates', rows: updateRows(input), ...(input.app && { note: <UpdatesNote /> }) },
    ] },
    { id: 'archive', label: 'Archive', icon: <Archive />, description: 'Abandoned items stay in their provider.', groups: [
      { title: 'Abandoned items', description: 'The board does not list abandoned items yet.', rows: [],
        note: <p className="m-0 text-xs text-(--muted-foreground)">Reopen issues on GitHub or reactivate work items in Azure DevOps.</p> },
    ] },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Stethoscope />, description: 'The commands the board runs, and its server.', groups: [
      { title: 'Tools', rows: [
        ...DIAGNOSED.filter(([name]) => name !== 'gh' || !ghSkipped(data)).map(([name, does]): Row => ({
          id: `d-${name}`, title: name, description: toolDescription(does, data.tools?.[name]), control: custom(() => <ToolState {...stateOf(data, name)} />),
        })),
        { id: 'd-az', title: 'az', description: toolDescription(`Reads repositories on Azure DevOps.${azSkipped(data)}`, data.tools?.az),
          control: custom(() => <ToolState {...stateOf(data, 'az')} />) },
        { id: 'd-server', title: 'Board server', description: `${location.origin} · last read ${data.fetchedAt ? 'OK' : 'never'}`, control: custom(() => null) },
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
  return <>{where}Fix: <code className="whitespace-nowrap">{check.fix}</code></>;
}
