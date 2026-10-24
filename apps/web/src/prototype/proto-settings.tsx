// PROTOTYPE, throwaway. The companion app's Settings, laid out as T3 Code's: the sidebar turns into a
// searchable section list with Back at its foot (where Settings sat), and the main pane shows a
// "Settings › Section" breadcrumb over grouped rows. Every value lives in memory; nothing is saved.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { create } from 'zustand';
import {
  Archive, ArrowLeft, Bell, FolderGit2, Keyboard, Palette, Plug, RefreshCw, RotateCcw, Search, Settings2, Sparkles, Stethoscope,
} from 'lucide-react';
import type { BoardData } from '@mux-factory/shared';
import { NativeSelect } from '@mux-factory/ui/native-select';
import { Button, Kbd, PlatformTag, SidebarButton, drag, noDrag } from './chrome.tsx';

type Control =
  | { type: 'switch'; value: boolean }
  | { type: 'select'; options: string[]; value: string }
  | { type: 'segmented'; options: string[]; value: string }
  | { type: 'number'; value: number; suffix?: string }
  | { type: 'text'; value: string; mono?: boolean }
  | { type: 'kbd'; keys: string[] }
  | { type: 'custom'; render: () => ReactNode };

interface Row { id: string; title: string; description?: string; control: Control }
interface Group { title: string; description?: string; rows: Row[]; footer?: ReactNode }
export interface Page { id: string; label: string; icon: ReactNode; groups: Group[] }

const useValues = create<{ values: Record<string, unknown>; set: (id: string, v: unknown) => void }>()((set) => ({
  values: {},
  set: (id, v) => set((s) => ({ values: { ...s.values, [id]: v } })),
}));

export function pages(data: BoardData): Page[] {
  const models = ['T3 default', ...data.modelChoices.flatMap((g) => g.models.map((m) => `${g.name} · ${m.label}`))];
  return [
    { id: 'general', label: 'General', icon: <Settings2 />, groups: [
      { title: 'Board', rows: [
        { id: 'refresh', title: 'Refresh every', description: 'How often the board reads the GitHub Project through gh.', control: { type: 'select', options: ['15 seconds', '30 seconds', '45 seconds', '1 minute', '5 minutes'], value: `${data.refreshSeconds} seconds` } },
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
        { id: 'menu-bar', title: 'Show in the menu bar', description: 'A µx icon with the Needs you count; click for a quick list.', control: { type: 'switch', value: true } },
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
      { title: 'Platform colours', rows: data.repos.map((r) => ({ id: `color-${r.platform}`, title: r.platform, description: r.repo, control: { type: 'custom', render: () => <PlatformTag platform={r.platform} /> } })) },
    ] },
    { id: 'repos', label: 'Repositories', icon: <FolderGit2 />, groups: [
      { title: 'GitHub Project', rows: [
        { id: 'project', title: data.project.title, description: 'The Project the board reads and moves items on.', control: { type: 'text', value: 'maddec01 / Mux', mono: true } },
        { id: 'gh', title: 'GitHub CLI', description: 'Reads through your gh login. The board never stores a token.', control: { type: 'custom', render: () => <span className="text-xs font-medium text-(--success-foreground)">● Signed in</span> } },
      ] },
      { title: 'Repositories', description: 'Each repo’s platform names its List group and colour; its role goes to mux-work.', rows: data.repos.map((r) => ({
        id: `repo-${r.repo}`, title: r.repo, description: r.role, control: { type: 'custom', render: () => <span className="flex items-center gap-2"><PlatformTag platform={r.platform} /><Button small>Edit</Button></span> },
      })), footer: <Button small>Add repository</Button> },
    ] },
    { id: 't3', label: 'T3 Code', icon: <Plug />, groups: [
      { title: 'Connection', rows: [
        { id: 't3-app', title: 'T3 Code (Nightly)', description: '~/.t3/userdata · read for thread stats and the model list', control: { type: 'custom', render: () => <span className="text-xs font-medium text-(--success-foreground)">● Connected</span> } },
        { id: 't3-stats', title: 'Read thread stats', description: 'Agent time, tokens and cost on each item.', control: { type: 'switch', value: true } },
      ] },
      { title: 'Start', description: 'What Start does when it opens a mux-work thread.', rows: [
        { id: 'model', title: 'Default model', control: { type: 'select', options: models, value: 'T3 default' } },
        { id: 'workspace', title: 'Workspace', control: { type: 'segmented', options: ['New worktree', 'Local checkout'], value: 'New worktree' } },
        { id: 'base', title: 'Base branch', control: { type: 'text', value: 'main', mono: true } },
        { id: 'title', title: 'Thread title', control: { type: 'text', value: '{ref} {title}', mono: true } },
        { id: 'switch-after', title: 'Switch to T3 Code after Start', control: { type: 'switch', value: true } },
      ] },
    ] },
    { id: 'skills', label: 'Skills', icon: <Sparkles />, groups: [
      { title: 'Claude profiles', description: 'The app links its skills and copies its checklists into each ticked profile.', rows: ['~/.claude', '~/.claude-personal', '~/.claude-work'].map((p, i) => ({ id: `profile-${p}`, title: p, control: { type: 'switch', value: i < 2 } })) },
      { title: 'Skill sync', rows: [
        { id: 'sync', title: 'Upstream skills', description: '14 skills · last synced 2 days ago', control: { type: 'custom', render: () => <Button small><RefreshCw /> Sync now</Button> } },
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
      { title: 'Updates', rows: [
        { id: 'channel', title: 'Update channel', description: 'Nightly offers each Nightly Release; Latest only Stable Releases.', control: { type: 'segmented', options: ['Nightly', 'Latest'], value: 'Nightly' } },
        { id: 'version', title: 'Mux Factory 0.1.0-nightly.42', description: 'Up to date · checked 3 minutes ago', control: { type: 'custom', render: () => <Button small>Check now</Button> } },
        { id: 'auto-install', title: 'Install when I quit', control: { type: 'switch', value: true } },
      ] },
    ] },
    { id: 'archive', label: 'Archive', icon: <Archive />, groups: [
      { title: 'Abandoned', description: 'Items closed as not planned from the board, last 30 days.', rows: [
        { id: 'ab-1', title: '#88 Bonjour discovery fallback', description: 'Server · abandoned 4 days ago', control: { type: 'custom', render: () => <Button small>Restore</Button> } },
        { id: 'ab-2', title: '#41 Picture-in-picture on iPad', description: 'Apple · abandoned 12 days ago', control: { type: 'custom', render: () => <Button small>Restore</Button> } },
      ] },
    ] },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Stethoscope />, groups: [
      { title: 'Tools', rows: [
        { id: 'd-gh', title: 'gh', description: '/opt/homebrew/bin/gh · 2.81.0', control: { type: 'custom', render: () => <span className="text-xs text-(--success-foreground)">● OK</span> } },
        { id: 'd-t3', title: 't3', description: '~/.t3/bin/t3', control: { type: 'custom', render: () => <span className="text-xs text-(--success-foreground)">● OK</span> } },
        { id: 'd-server', title: 'Board server', description: `127.0.0.1:4317 · last read ${data.fetchedAt ? 'OK' : 'never'}`, control: { type: 'custom', render: () => <Button small>Open logs</Button> } },
      ] },
    ] },
  ];
}

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${on ? 'bg-(--primary)' : 'bg-(--input)'}`}>
      <span className={`absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-all ${on ? 'left-[16px]' : 'left-[2px]'}`} />
    </button>
  );
}

const field = 'h-7 rounded-(--control-radius) border border-(--input) bg-(--background) px-2 text-[13px] text-(--foreground)';

function ControlView({ row }: { row: Row }) {
  const { values, set } = useValues();
  const c = row.control;
  const v = values[row.id] ?? ('value' in c ? c.value : undefined);
  switch (c.type) {
    case 'switch': return <Switch on={v as boolean} onChange={(x) => set(row.id, x)} />;
    case 'select': return <NativeSelect className="w-auto" value={v as string} onChange={(e) => set(row.id, e.target.value)}>{c.options.map((o) => <option key={o}>{o}</option>)}</NativeSelect>;
    case 'number': return <span className="flex items-center gap-1"><input className={`${field} w-16 text-right tabular-nums`} type="number" value={v as number} onChange={(e) => set(row.id, Number(e.target.value))} />{c.suffix && <span className="text-xs text-(--muted-foreground)">{c.suffix}</span>}</span>;
    case 'text': return <input className={`${field} w-48 ${c.mono ? 'font-mono text-xs' : ''}`} value={v as string} onChange={(e) => set(row.id, e.target.value)} />;
    case 'kbd': return <span className="flex gap-1">{c.keys.map((k) => <Kbd key={k}>{k}</Kbd>)}</span>;
    case 'custom': return <>{c.render()}</>;
    case 'segmented': return (
      <span className="inline-flex rounded-(--control-radius) bg-(--accent) p-0.5">
        {c.options.map((o) => (
          <button type="button" key={o} onClick={() => set(row.id, o)}
            className={`h-6 rounded-[calc(var(--control-radius)-2px)] px-2.5 text-xs font-medium ${v === o ? 'bg-(--card) text-(--foreground) shadow-sm' : 'text-(--muted-foreground) hover:text-(--foreground)'}`}>{o}</button>
        ))}
      </span>
    );
  }
}

/** T3's SettingsGroup: a title over a bordered list of rows, label left and control right. */
function GroupView({ group, compact }: { group: Group; compact?: boolean }) {
  return (
    <section className="grid gap-2">
      <div className="px-1">
        <h3 className="m-0 text-[13px] font-medium">{group.title}</h3>
        {group.description && <p className="m-0 text-xs text-(--muted-foreground)">{group.description}</p>}
      </div>
      <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--card)">
        {group.rows.map((row) => (
          <div key={row.id} className={`flex ${compact ? 'flex-wrap' : ''} items-center gap-x-4 gap-y-2 px-4 py-3`}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{row.title}</div>
              {row.description && <div className="text-xs text-(--muted-foreground)">{row.description}</div>}
            </div>
            <ControlView row={row} />
          </div>
        ))}
        {group.footer && <div className="bg-(--muted) px-4 py-2">{group.footer}</div>}
      </div>
    </section>
  );
}

export function SettingsBody({ page, compact }: { page: Page; compact?: boolean }) {
  return <div className="grid gap-6">{page.groups.map((g) => <GroupView group={g} compact={compact} key={g.title} />)}</div>;
}

/** The settings section list that takes the sidebar's place: search on top, Back at the foot, where Settings was. */
export function SettingsNav({ all, current, onPick, onBack }: { all: Page[]; current: string; onPick: (id: string) => void; onBack: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((p) => p.label.toLowerCase().includes(q) || p.groups.some((g) => g.rows.some((r) => r.title.toLowerCase().includes(q)))) : all;
  return (
    <>
      <div className="px-2 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-(--border) bg-(--background) px-2 text-(--muted-foreground) [&_svg]:size-3.5">
          <Search /><input className="min-w-0 flex-1 bg-transparent text-[13px] text-(--foreground) outline-none placeholder:text-(--muted-foreground)" placeholder="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} /><Kbd>/</Kbd>
        </label>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2">
        {shown.map((p) => <SidebarButton key={p.id} icon={p.icon} label={p.label} active={p.id === current} onClick={() => onPick(p.id)} />)}
      </nav>
      <div className="border-t border-(--border) p-2">
        <SidebarButton icon={<ArrowLeft />} label="Back" onClick={onBack} />
      </div>
    </>
  );
}

/** The main pane's header in Settings: T3's breadcrumb, then Restore defaults on the right. */
export function SettingsHeader({ page, leading }: { page: Page; leading?: ReactNode }) {
  const reset = useValues((s) => s.values);
  return (
    <header className={`flex h-[52px] shrink-0 items-center gap-2 border-b border-(--border) px-4 ${drag}`}>
      {leading}
      <span className="text-[13px] text-(--muted-foreground)">Settings</span><span className="text-(--muted-foreground)">›</span>
      <span className="text-[13px] font-medium">{page.label}</span>
      <span className={`ml-auto ${noDrag}`}>
        <Button small onClick={() => useValues.setState({ values: {} })}><RotateCcw /> Restore defaults{Object.keys(reset).length ? ` (${Object.keys(reset).length})` : ''}</Button>
      </span>
    </header>
  );
}
