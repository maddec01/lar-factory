// The Settings sections and their grouped rows, from the control room prototype. Most rows aren't built yet: they
// show the prototype's value, disabled. The working rows are the Claude profiles, the update channel, version and
// Check now, the command check rows, the gh and az logins, the GitHub Project and repositories, read-only, and the
// bundled skills with their authors, licences and sources. In a browser the profiles and updates, which only the board
// app has, show the prototype's values, disabled with that reason.

import type { ComponentProps, ReactNode } from 'react';
import { Archive, Bell, ExternalLink, FolderGit2, Keyboard, Palette, Plug, RefreshCw, Settings2, Sparkles, Stethoscope } from 'lucide-react';
import { GH_FLOOR, type BoardData, type CheckedTool, type ToolCheck } from '@lar-factory/shared';
import type { ClaudeProfile } from '@lar-factory/shared/install-skills';
import { Button } from '@lar-factory/ui/button';
import { PlatformTag } from '../items/item-parts.tsx';
import { CheckNow, ChannelChoice, ProfileSwitch, ProfilesNote, UpdateStatus, UpdatesNote } from './app-rows.tsx';
import { type Control, ReadOnlyText, SmallButton, ToolState, notBuilt } from './controls.tsx';
import { profilePath } from './settings-store.ts';

interface Row {
  id: string;
  title: string;
  description?: ReactNode;
  control: Control;
  /** Why a value-only control is disabled; by default, that the row isn't built yet. */
  reason?: string;
}
export interface Group { title: string; description?: string; rows: Row[]; footer?: ReactNode; note?: ReactNode }
export interface Page { id: string; label: string; icon: ReactNode; groups: Group[] }

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
function toolState(check: ToolCheck | undefined, login = false): ComponentProps<typeof ToolState> {
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

/** Who wrote each skill and checklist the app bundles, under which licence, with a link to its source. */
function bundledGroup({ data }: PagesInput): Group {
  const skills = data.bundledSkills ?? [];
  const rows: Row[] = skills.length ? skills.map((skill) => ({
    id: `bundled-${skill.name}`, title: skill.name, description: `${skill.author} · ${skill.licence}`,
    control: custom(() => <Button variant="outline" size="xs" aria-label={`${skill.name} source`} render={<a href={skill.source} target="_blank" rel="noopener" />}><ExternalLink /> Source</Button>),
  })) : [{ id: 'bundled-unread', title: 'Couldn’t read the bundled skills', description: 'The board server couldn’t read the app’s bundle, so it can’t credit them here.', control: custom(() => null) }];
  return { title: 'Bundled skills', description: 'The skills and checklists the app installs, and who wrote them.', rows };
}

function updateRows({ app, version }: PagesInput): Row[] {
  const channel = { id: 'channel', title: 'Update channel', description: 'Nightly offers each Nightly Release; Latest only Stable Releases.' };
  const install: Row = { id: 'auto-install', title: 'Install when I quit', control: { type: 'switch', value: true } };
  if (!app) {
    return [
      { ...channel, control: { type: 'segmented', options: ['Nightly', 'Latest'], value: 'Nightly' }, reason: ONLY_APP_UPDATES },
      { id: 'version', title: 'Lar Factory 0.1.0-nightly.42', description: 'Up to date · checked 3 minutes ago', control: { type: 'button', label: 'Check now' }, reason: ONLY_APP_UPDATES },
      install,
    ];
  }
  return [
    { ...channel, control: custom(() => <ChannelChoice />) },
    { id: 'version', title: version ? `Lar Factory ${version}` : 'Lar Factory', description: <UpdateStatus />, control: custom(() => <CheckNow />) },
    install,
  ];
}

export function pages(input: PagesInput): Page[] {
  const { data } = input;
  const models = ['T3 default', ...data.modelChoices.flatMap((g) => g.models.map((m) => `${g.name} · ${m.label}`))];
  const project = data.project.owner ? `${data.project.owner} / ${data.project.title}` : data.project.title;
  return [
    { id: 'general', label: 'General', icon: <Settings2 />, groups: [
      { title: 'Board', rows: [
        { id: 'refresh', title: 'Refresh every', description: 'How often the board reads the GitHub Project through gh.', control: refreshEvery(data.refreshSeconds) },
        { id: 'done-window', title: 'Done shows', description: 'Items closed within this window stay on the board.', control: { type: 'select', options: ['3 days', '7 days', '14 days', '30 days'], value: '7 days' } },
        { id: 'open-in', title: 'Open an item in', control: { type: 'segmented', options: ['GitHub', 'T3 thread', 'Ask'], value: 'T3 thread' } },
        { id: 'confirm-abandon', title: 'Confirm before Abandon', description: 'Abandon closes the issue as not planned.', control: { type: 'switch', value: true } },
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
        { id: 'dock-side', title: 'Dock beside T3 Code', description: 'Snaps the window to T3 Code’s edge and follows it.', control: { type: 'segmented', options: ['Off', 'Left', 'Right'], value: 'Off' } },
      ] },
    ] },
    { id: 'appearance', label: 'Appearance', icon: <Palette />, groups: [
      { title: 'Theme', rows: [
        { id: 'scheme', title: 'Color scheme', control: { type: 'segmented', options: ['System', 'Light', 'Dark'], value: 'System' } },
        { id: 'follow-t3', title: 'Follow T3 Code’s theme', description: 'Reads T3 Code’s theme, contrast and glass opacity, so the two windows match.', control: { type: 'switch', value: true } },
        { id: 'density', title: 'Density', control: { type: 'segmented', options: ['Comfortable', 'Compact'], value: 'Comfortable' } },
        { id: 'font-size', title: 'Interface font size', control: { type: 'number', value: 13, suffix: 'px' } },
      ] },
      { title: 'Items show', rows: [
        { id: 'show-status-bar', title: 'Status bar', description: 'Ten steps from List to Done.', control: { type: 'switch', value: true } },
        { id: 'show-slices', title: 'Slice bar', control: { type: 'switch', value: true } },
        { id: 'show-stats', title: 'Agent time, tokens and cost', control: { type: 'switch', value: true } },
        { id: 'show-labels', title: 'Labels', control: { type: 'switch', value: false } },
      ] },
      { title: 'Platform colours', rows: data.repos.map((r) => ({ id: `color-${r.platform}`, title: r.platform, description: r.repo, control: custom(() => <PlatformTag platform={r.platform} />) })) },
    ] },
    { id: 'repos', label: 'Repositories', icon: <FolderGit2 />, groups: [
      { title: 'GitHub Project', rows: [
        { id: 'project', title: data.project.title, description: 'The Project the board reads and moves items on.', control: custom(() => <ReadOnlyText label="GitHub Project" value={project} />) },
      ] },
      { title: 'Command line tools', description: 'The board reads each provider through your own login and never stores a token.', rows: [
        { id: 'gh', title: 'GitHub CLI', description: toolDescription('gh, for repositories on GitHub.', data.tools?.gh),
          control: custom(() => <ToolState {...toolState(data.tools?.gh, true)} />) },
        { id: 'az', title: 'Azure CLI', description: toolDescription(`az with the azure-devops extension, for repositories on Azure DevOps.${azSkipped(data)}`, data.tools?.az),
          control: custom(() => <ToolState {...toolState(data.tools?.az, true)} />) },
      ] },
      { title: 'Repositories', description: 'Each repo’s platform names its List group and colour; its role goes to lar-work.', rows: data.repos.map((r) => ({
        id: `repo-${r.repo}`, title: r.repo, description: r.role,
        control: custom(() => <span className="flex items-center gap-2"><PlatformTag platform={r.platform} /><SmallButton reason={notBuilt('Edit')}>Edit</SmallButton></span>),
      })), footer: <SmallButton reason={notBuilt('Add repository')}>Add repository</SmallButton> },
    ] },
    { id: 't3', label: 'T3 Code', icon: <Plug />, groups: [
      { title: 'Connection', rows: [
        { id: 't3-app', title: 'T3 Code (Nightly)', description: '~/.t3/userdata · read for thread stats and the model list', control: { type: 'status', text: 'Connected', tone: 'success' } },
        { id: 't3-stats', title: 'Read thread stats', description: 'Agent time, tokens and cost on each item.', control: { type: 'switch', value: true } },
      ] },
      { title: 'Start', description: 'What Start does when it opens a lar-work thread.', rows: [
        { id: 'model', title: 'Default model', control: { type: 'select', options: models, value: 'T3 default' } },
        { id: 'workspace', title: 'Workspace', control: { type: 'segmented', options: ['New worktree', 'Local checkout'], value: 'New worktree' } },
        { id: 'base', title: 'Base branch', control: { type: 'text', value: 'main', mono: true } },
        { id: 'title', title: 'Thread title', control: { type: 'text', value: '{ref} {title}', mono: true } },
        { id: 'switch-after', title: 'Switch to T3 Code after Start', control: { type: 'switch', value: true } },
      ] },
    ] },
    { id: 'skills', label: 'Skills', icon: <Sparkles />, groups: [
      profileGroup(input),
      bundledGroup(input),
      { title: 'Skill sync', rows: [
        { id: 'sync', title: 'Upstream skills', description: '14 skills · last synced 2 days ago', control: { type: 'button', label: <><RefreshCw /> Sync now</> }, reason: notBuilt('Sync now') },
        { id: 'sync-auto', title: 'Check upstream weekly', control: { type: 'switch', value: true } },
      ] },
    ] },
    { id: 'notifications', label: 'Notifications', icon: <Bell />, groups: [
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
    { id: 'keybindings', label: 'Keybindings', icon: <Keyboard />, groups: [
      { title: 'Keybindings', rows: ([
        ['Add item', ['⌘', 'N']], ['Search items', ['⌘', 'K']], ['Refresh', ['⌘', 'R']], ['Next item', ['J']], ['Previous item', ['K']],
        ['Start in T3 Code', ['⌘', '↵']], ['Queue', ['Q']], ['Open on GitHub', ['⌘', 'O']], ['Switch to T3 Code', ['⌘', '⇧', 'T']], ['Settings', ['⌘', ',']],
      ] as [string, string[]][]).map(([t, k]) => ({ id: `kb-${t}`, title: t, control: { type: 'kbd', keys: k } })) },
    ] },
    { id: 'updates', label: 'Updates', icon: <RefreshCw />, groups: [
      { title: 'Updates', rows: updateRows(input), ...(input.app && { note: <UpdatesNote /> }) },
    ] },
    { id: 'archive', label: 'Archive', icon: <Archive />, groups: [
      { title: 'Abandoned', description: 'Items closed as not planned from the board, last 30 days.', rows: [
        { id: 'ab-1', title: '#88 Bonjour discovery fallback', description: 'Server · abandoned 4 days ago', control: { type: 'button', label: 'Restore' }, reason: notBuilt('Restore') },
        { id: 'ab-2', title: '#41 Picture-in-picture on iPad', description: 'Apple · abandoned 12 days ago', control: { type: 'button', label: 'Restore' }, reason: notBuilt('Restore') },
      ] },
    ] },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Stethoscope />, groups: [
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
function toolDescription(does: string, check: ToolCheck | undefined): ReactNode {
  if (!check || check.result === 'ok') return does;
  if (check.result === 'not-running') return 'Open T3 Code.';
  const where = check.result === 'missing' && check.override ? `Nothing runnable at ${check.override}. ` : '';
  if (!('fix' in check)) return `${where}Install T3 Code.`;
  const upgrade = check.result === 'no-project-scope' && check.upgrade;
  return <>{where}Fix: <code className="whitespace-nowrap">{check.fix}</code>{upgrade && <>, then <code className="whitespace-nowrap">{upgrade}</code></>}</>;
}
