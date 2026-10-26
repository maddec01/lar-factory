// The Settings page, laid out as T3 Code's, from the control room prototype: the sidebar's Settings button opens it,
// the sidebar turns into a searchable section list with Back at its foot, where Settings sat, and the main area shows
// a "Settings › Section" breadcrumb over the section's grouped rows. Back returns to the board as it was.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, RotateCcw, Search, Settings as SettingsIcon } from 'lucide-react';
import { boardApp } from '@lar-factory/shared';
import { SidebarMenuButton } from '@lar-factory/ui/sidebar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/tooltip';
import { useBoardStore } from '../board/board-store.ts';
import { RepositoriesPrototype } from '../onboarding-prototype/variants.tsx';
import { PROTOTYPE } from '../onboarding-prototype/wizard-store.ts';
import { useTitlebarInset } from '../sidebar/window-controls.tsx';
import { useUpdateStore } from '../updates/update-store.ts';
import { Kbd, ShownControl, SmallButton, notBuilt } from './controls.tsx';
import { type Group, type Page, pages } from './settings-pages.tsx';
import { useSettingsStore } from './settings-store.ts';

function usePages(): Page[] {
  const data = useBoardStore((state) => state.data);
  const profiles = useSettingsStore((state) => state.profiles);
  const version = useUpdateStore((state) => state.state?.currentVersion ?? null);
  return pages({ data, app: !!boardApp(), profiles, version });
}

function useSection(all: Page[]): Page {
  const section = useSettingsStore((state) => state.section);
  return all.find((p) => p.id === section) ?? all[0]!;
}

/** The sidebar's foot button that opens Settings: T3's SidebarUtilityItem, a 32 px icon button with its label in a tooltip. */
export function SettingsButton() {
  return (
    <Tooltip>
      <TooltipTrigger render={<SidebarMenuButton size="icon" aria-label="Settings" className="open-settings" onClick={() => useSettingsStore.getState().setOpen(true)}><SettingsIcon /></SidebarMenuButton>} />
      <TooltipPopup side="top">Settings</TooltipPopup>
    </Tooltip>
  );
}

/** The prototype's sidebar row: an icon and a label, the selected one on the sidebar's selected colour. */
function SidebarButton({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined}
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-(--sidebar-foreground) hover:bg-(--sidebar-row-hover) [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-(--sidebar-muted-foreground) ${active ? 'bg-(--sidebar-row-selected) font-medium' : ''}`}>
      {icon}<span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** The section list that takes the sidebar's place: search on top, which / focuses, and Back at the foot. */
export function SettingsNav() {
  const all = usePages();
  const current = useSection(all);
  const { setSection, setOpen } = useSettingsStore();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
      if (event.key !== '/' || typing || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      search.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const q = query.trim().toLowerCase();
  const shown = q ? all.filter((p) => p.label.toLowerCase().includes(q) || p.groups.some((g) => g.rows.some((r) => r.title.toLowerCase().includes(q)))) : all;
  return (
    <>
      <div className="px-2 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-(--border) bg-(--background) px-2 text-(--muted-foreground) [&_svg]:size-3.5">
          <Search /><input ref={search} className="min-w-0 flex-1 bg-transparent text-[13px] text-(--foreground) outline-none placeholder:text-(--muted-foreground)" placeholder="Search settings" aria-label="Search settings" value={query} onChange={(e) => setQuery(e.target.value)} /><Kbd>/</Kbd>
        </label>
      </div>
      <nav className="settings-nav min-h-0 flex-1 overflow-y-auto px-2" aria-label="Settings">
        {shown.map((p) => <SidebarButton key={p.id} icon={p.icon} label={p.label} active={p.id === current.id} onClick={() => setSection(p.id)} />)}
      </nav>
      <div className="settings-foot border-t border-(--sidebar-border) p-2">
        <SidebarButton icon={<ArrowLeft />} label="Back" onClick={() => setOpen(false)} />
      </div>
    </>
  );
}

/** T3's SettingsGroup: a title over a bordered list of rows, label left and control right. */
function GroupView({ group }: { group: Group }) {
  return (
    <section className="settings-group grid gap-2">
      <div className="px-1">
        <h3 className="m-0 text-[13px] font-medium">{group.title}</h3>
        {group.description && <p className="m-0 text-xs text-(--muted-foreground)">{group.description}</p>}
      </div>
      <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--card)">
        {group.rows.map((row) => (
          <div key={row.id} className="settings-row flex items-center gap-x-4 gap-y-2 px-4 py-3" data-row={row.id}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium">{row.title}</div>
              {row.description && <div className="text-xs text-(--muted-foreground)">{row.description}</div>}
            </div>
            {row.control.type === 'custom'
              ? row.control.render()
              : <ShownControl control={row.control} label={row.title} reason={row.reason ?? notBuilt(row.title)} />}
          </div>
        ))}
        {group.footer && <div className="bg-(--muted) px-4 py-2">{group.footer}</div>}
      </div>
      {group.note}
    </section>
  );
}

/** The main area in Settings: T3's breadcrumb with Restore defaults on the right, over the section's groups. */
export function SettingsMain() {
  const page = useSection(usePages());
  const inset = useTitlebarInset();
  // The sidebar's update button follows the updater too, but it isn't there above the missing-t3 notice.
  const follow = useUpdateStore((state) => state.follow);
  useEffect(follow, [follow]);
  return (
    <>
      <header className={`settings-header flex h-13 shrink-0 select-none items-center gap-2 border-b border-(--border) pr-4 ${inset} [-webkit-app-region:drag]`}>
        <span className="text-[13px] text-(--muted-foreground)">Settings</span><span className="text-(--muted-foreground)" aria-hidden="true">›</span>
        <h1 className="m-0 text-[13px] font-medium">{page.label}</h1>
        <span className="ml-auto [-webkit-app-region:no-drag]">
          <SmallButton reason={notBuilt('Restore defaults')}><RotateCcw /> Restore defaults</SmallButton>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="settings-body mx-auto grid max-w-2xl gap-6 px-8 py-8">
          {/* PROTOTYPE (#363): the onboarding wizard's repository list, and variant C's checklist. */}
          {page.groups.map((g) => (PROTOTYPE && page.id === 'repos' && g.title === 'Repositories' ? <RepositoriesPrototype key={g.title} /> : <GroupView group={g} key={g.title} />))}
        </div>
      </div>
    </>
  );
}
