// Settings shows working controls and real read-only values. Unbuilt controls show their availability inline.

import { useState, type ComponentProps, type ReactNode } from 'react';
import { DIALOG_PREFERENCES, dialogPreference } from '../expand-dialog/expand-dialog.tsx';
import { Archive, ExternalLink, FolderGit2, Plug, RefreshCw, Settings2, Sparkles, Stethoscope } from 'lucide-react';
import { GH_FLOOR, blockedBy, clock, day, itemSource, repoName, shownRepo, type BoardData, type BundledSkill, type Item, type CheckedTool, type TargetSnapshot, type OnboardingProgress, type ToolCheck } from '@lar-factory/shared';
import type { BlockingPath } from '@lar-factory/shared/install-skills';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ArchiveActions, archivedAs, RetentionSetting } from '../archive/archive.tsx';
import { stoppedAt, useWizardStore } from '../onboarding/wizard-store.ts';
import { useEditStore } from '../repositories/edit-store.ts';
import { ChannelChoice, TargetSwitch, TargetsNote, UpdateAction, UpdateStatus, UpdatesNote } from './app-rows.tsx';
import { TargetProgress } from './target-progress.tsx';
import { TargetReaders } from './target-readers.tsx';
import { Switch, type Control, ToolState } from './controls.tsx';
import { kind } from '../buttons/button-kinds.tsx';
import { SourceIcon } from '../items/source-icon.tsx';

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
  /** The bridge's Skill folders, null while they load. */
  targets: TargetSnapshot[] | null;
  /** The running version, once the updater has said. */
  version: string | null;
  /** Archive's work as /api/archive answered last, null before Archive first reads it, and why that read failed. */
  archive: { items: Item[] | null; problem: string | null };
}

const ONLY_APP_TARGETS = 'Only the board app installs skills into agent folders.';
const ONLY_APP_UPDATES = 'Only the board app updates itself.';

/**
 * A command's state: the version it printed, else OK, noting scopes gh couldn't read; the problem its check found; or
 * Not checked before the first check, in sample mode, and for an az no listed repository needs.
 * A `login` row says Signed in or Signed out instead, and Signed in beside a gh too old.
 */
function toolState(check: ToolCheck | undefined, login = false): ComponentProps<typeof ToolState> {
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
  ['t3', 'Starts the lar-shape threads in T3 Code.'],
  ['git', "lar-build's agents branch, commit and push with it."],
  ['jq', "lar-shape's scripts read gh's answers with it."],
  ['curl', "lar-shape's scripts tell the board to refresh with it."],
];

const custom = (render: () => ReactNode): Control => ({ type: 'custom', render });

/** Whether the check leaves gh out, as no listed repository is on GitHub; Diagnostics then leaves gh out. */
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

/** A repository still onboarding: its provider and the step it stopped at. */
function onboardingDescription(progress: OnboardingProgress): string {
  return [progress.answers.provider, `Onboarding, ${stoppedAt(progress)}`].filter(Boolean).join(' · ');
}

/**
 * Each repository on this Mac's list by its name: an onboarded one with its provider and item source,
 * Edit, which opens Edit's dialog once the board has its setup; one still onboarding with what it has answered, the
 * step it stopped at and Resume. Add repository opens the onboarding dialog. The
 * board reads GitHub repositories and Azure DevOps sprints.
 */
function repositoryGroup(data: BoardData): Group {
  const onboarded: Row[] = data.repos.map((r) => ({
    id: `repo-${r.repo}`, title: shownRepo(r.repo), description: <>{itemSource(r) === 'azure-board' ? 'Azure DevOps' : 'GitHub'} · {sourceName(itemSource(r), r.team)}</>,
    control: custom(() => r.setup ? <Button {...kind('other')} onClick={() => useEditStore.getState().open(r.repo)}>Edit</Button> : null),
  }));
  const onboarding: Row[] = (data.onboarding ?? []).map(({ repo, progress }) => ({
    id: `repo-${repo}`, title: shownRepo(repo), description: onboardingDescription(progress),
    control: custom(() => <Button {...kind('other')} onClick={() => useWizardStore.getState().resume(repo)}>Resume</Button>),
  }));
  return { title: 'Repositories', description: 'Settings stay on this machine. Repositories need no factory files.',
    rows: [...onboarded, ...onboarding],
    footer: <Button {...kind('other')} onClick={() => useWizardStore.getState().start()}>Add repository</Button> };
}

/** Why a target can't be unticked, or nothing. */
function lockedReason({ locked, instances }: TargetSnapshot): string | undefined {
  if (!locked) return undefined;
  return instances.length > 0 ? "T3 Code's provider instances read it, so it stays ticked." : "Claude's skill links point here, so it stays ticked.";
}

/**
 * What a target's row says: for a selected target whose provider home doesn't exist, that it isn't installed until
 * the home does, since its switch shows off; otherwise why it can't be unticked, or nothing.
 */
function targetNote(target: TargetSnapshot): string | undefined {
  if (!target.homeMissing) return lockedReason(target);
  const home = target.path.replace(/\/skills$/, '');
  const why = target.instances.length > 0 ? "T3 Code's provider instances read it; " : '';
  return `Not installed until ${home} exists. ${why}Lar Factory installs here once it exists.`;
}

function targetGroup({ app, targets }: PagesInput): Group {
  const description = 'The app installs its skills into each ticked folder: copies, or links in a Claude home.';
  if (!app) return { title: 'Skill folders', description: ONLY_APP_TARGETS, rows: [] };
  return {
    title: 'Skill folders', description, note: <TargetsNote />,
    rows: (targets ?? []).map((target) => ({
      id: `target-${target.path}`, title: target.path, description: targetNote(target), control: custom(() => <TargetSwitch path={target.path} reason={targetNote(target)} />),
      below: <><TargetReaders target={target} /><TargetProgress target={target} /></>,
    })),
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
    id: `bundled-${skill.name}`, title: skill.name, description: <>{skill.author} · {skill.licence}{updated(skill)}{skill.includedAuthors?.length ? <span className="block">Includes work by {skill.includedAuthors.join(', ')}. <a href={skill.notices} target="_blank" rel="noopener" className="underline">THIRD_PARTY_NOTICES.md</a></span> : null}<BlockedReason status={skill.status} /></>,
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

/** This Mac's retention setting, then each piece of work in Archive with what it offers; none in sample mode. */
function archiveGroups(data: BoardData, archive: PagesInput['archive']): Group[] {
  if (!data.retention) return [{ title: 'Archive', description: 'Sample mode keeps no work records.', rows: [] }];
  const retention = data.retention;
  const work: Row[] = (archive.items ?? []).map((item) => ({
    id: `archived-${item.id}`, title: item.title || item.id,
    description: <span className="inline-flex min-w-0 items-center gap-2"><SourceIcon item={item} /><span className="min-w-0 wrap-anywhere">{[shownRepo(item.repo), item.number ? `#${item.number}` : 'No ticket', archivedAs(item)].join(' · ')}</span></span>,
    control: custom(() => <ArchiveActions item={item} />),
  }));
  return [
    { title: 'Retention', description: 'Finished and set-aside work leaves the board after this many days. Nothing is deleted unless you turn on a timed delete.', rows: [
      { id: 'retention', title: 'Keep work', control: custom(() => null), below: <RetentionSetting retention={retention} /> },
    ] },
    { title: 'Set aside and hidden', rows: work,
      description: archive.problem ?? (archive.items === null ? 'Reading Archive…' : work.length ? undefined : 'No work is set aside or hidden.') },
  ];
}

export function pages(input: PagesInput): Page[] {
  const { data } = input;
  return [
    { id: 'general', label: 'General', icon: <Settings2 />, description: 'Board preferences.', groups: [
      { title: 'Dialogs', rows: [
        { id: 'match-list-size', title: 'Match list size when opening an item', control: custom(() => <DialogPreference preference="matchList" label="Match list size when opening an item" />) },
        { id: 'open-list-expanded', title: 'Open list expanded', control: custom(() => <DialogPreference preference="openList" label="Open list expanded" />) },
      ] },
      { title: 'Refresh', rows: [{ id: 'refresh', title: 'Full refresh', description: 'Changes also arrive between full refreshes.', control: refreshEvery(data.refreshSeconds) }] },
    ] },
    { id: 'repos', label: 'Repositories', icon: <FolderGit2 />, description: 'The repositories and issue sources shown on the board.', groups: [repositoryGroup(data)] },
    { id: 'integrations', label: 'Integrations', icon: <Plug />, description: 'Provider logins shared by your repositories.', groups: [
      { title: 'Issue trackers', description: 'Uses your own command line login. Lar Factory never stores a token.', rows: [
        { id: 'gh', title: 'GitHub', description: toolDescription('Uses your GitHub CLI login.', data.tools?.gh),
          control: custom(() => <ToolState {...stateOf(data, 'gh', true)} />) },
        { id: 'az', title: 'Azure DevOps', description: toolDescription(`Uses your Azure CLI login and Azure DevOps extension.${azSkipped(data)}`, data.tools?.az),
          control: custom(() => <ToolState {...stateOf(data, 'az', true)} />) },
      ] },
    ] },
    { id: 'skills', label: 'Skills', icon: <Sparkles />, description: 'The skills and checklists Lar Factory installs, and the folders that get them.', groups: [
      targetGroup(input),
      bundledGroup(input),
    ] },
    { id: 'updates', label: 'Updates', icon: <RefreshCw />, description: 'Which Releases Lar Factory offers, and when it installs them.', groups: [
      { title: 'Updates', rows: updateRows(input), ...(input.app && { note: <UpdatesNote /> }) },
    ] },
    { id: 'archive', label: 'Archive', icon: <Archive />, description: 'Work off the board: set aside, or finished and hidden. This Mac keeps it until a timed delete runs.', groups: archiveGroups(data, input.archive) },
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
function toolDescription(does: string, check: ToolCheck | undefined): ReactNode {
  if (!check || check.result === 'ok') return does;
  if (check.result === 'not-running') return 'Open T3 Code.';
  const where = check.result === 'missing' && check.override ? `Nothing runnable at ${check.override}. ` : '';
  if (!('fix' in check)) return `${where}Install T3 Code.`;
  return <>{where}Fix: <code className="whitespace-nowrap">{check.fix}</code></>;
}
