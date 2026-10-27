// Settings, as lar-server's SettingsDialog: the sidebar's Settings button opens a modal over the board with the
// sections on the left, in groups, and the open section on the right under its title and description. Search settings,
// on top of the sections and focused by /, keeps the sections whose name or a row matches, or says none does. Closing it
// returns to the board as it was, since the board stays rendered under it.

import { useEffect, useRef, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { boardApp } from '@lar-factory/shared';
import { Input } from '@lar-factory/ui/design-system/Input';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { SidebarNavigationItem } from '@lar-factory/ui/design-system/SidebarNavigationItem';
import { SidebarNavigationGroup, SidebarPane } from '@lar-factory/ui/design-system/SidebarPane';
import { SidebarMenuButton } from '@lar-factory/ui/sidebar';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/tooltip';
import { useBoardStore } from '../board/board-store.ts';
import { useWizardStore } from '../onboarding/wizard-store.ts';
import { useEditStore } from '../repositories/edit-store.ts';
import { useResetStore } from '../repositories/reset-store.ts';
import { useUpdateStore } from '../updates/update-store.ts';
import { ShownControl, notBuilt } from './controls.tsx';
import { type Group, type Page, pages } from './settings-pages.tsx';
import { useSettingsStore } from './settings-store.ts';

/** The section list's groups, by section id. */
const NAV: { label: string; ids: string[] }[] = [
  { label: 'Board', ids: ['general', 'appearance', 'notifications', 'keybindings'] },
  { label: 'Connections', ids: ['repos', 't3', 'skills'] },
  { label: 'App', ids: ['updates', 'archive', 'diagnostics'] },
];

/** The sidebar's foot button that opens Settings: T3's SidebarUtilityItem, a 32 px icon button with its label in a tooltip. */
export function SettingsButton() {
  return (
    <Tooltip>
      <TooltipTrigger render={<SidebarMenuButton size="icon" aria-label="Settings" className="open-settings" onClick={() => useSettingsStore.getState().setOpen(true)}><SettingsIcon /></SidebarMenuButton>} />
      <TooltipPopup side="top">Settings</TooltipPopup>
    </Tooltip>
  );
}

/** T3's SettingsGroup: a title over a bordered list of rows, label left and control right, and what a row has below them. */
function GroupView({ group }: { group: Group }) {
  return (
    <section className="settings-group grid gap-3">
      <div>
        <h3 className="m-0 text-[13px] font-semibold">{group.title}</h3>
        {group.description && <p className="m-0 mt-0.5 text-xs text-(--muted-foreground)">{group.description}</p>}
      </div>
      <div className="divide-y divide-(--border) overflow-hidden rounded-xl border border-(--border) bg-(--card)">
        {group.rows.map((row) => (
          <div key={row.id} className="settings-row grid gap-2 px-4 py-3" data-row={row.id}>
            <div className="flex items-center gap-x-6 gap-y-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium">{row.title}</div>
                {row.description && <div className="text-xs text-(--muted-foreground)">{row.description}</div>}
              </div>
              {row.control.type === 'custom'
                ? row.control.render()
                : <ShownControl control={row.control} label={row.title} reason={row.reason ?? notBuilt(row.title)} />}
            </div>
            {row.below}
          </div>
        ))}
        {group.footer && <div className="bg-(--muted) px-4 py-2">{group.footer}</div>}
      </div>
      {group.note}
    </section>
  );
}

function SettingsModal() {
  const data = useBoardStore((state) => state.data);
  const profiles = useSettingsStore((state) => state.profiles);
  const version = useUpdateStore((state) => state.state?.currentVersion ?? null);
  const { section, setSection, setOpen } = useSettingsStore();
  // The sidebar's update button follows the updater too, but it isn't there above the missing-t3 notice.
  const follow = useUpdateStore((state) => state.follow);
  useEffect(follow, [follow]);
  const all = pages({ data, app: !!boardApp(), profiles, version });
  const byId = new Map(all.map((p) => [p.id, p]));
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
      // A dialog over Settings, such as Edit, keeps its keys.
      const over = event.target instanceof Node && event.target !== document.body && !search.current?.closest('[role="dialog"]')?.contains(event.target);
      if (event.key !== '/' || typing || over || event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      search.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const q = query.trim().toLowerCase();
  const matches = (p: Page) => !q || p.label.toLowerCase().includes(q) || p.groups.some((g) => g.rows.some((r) => r.title.toLowerCase().includes(q)));
  const nav = NAV.map((group) => ({ label: group.label, pages: group.ids.map((id) => byId.get(id)).filter((p): p is Page => !!p && matches(p)) }));
  const open = byId.get(section) ?? all[0]!;
  // A search that leaves out the open section shows the first section it keeps, without choosing it, so clearing the
  // search goes back. One that keeps none leaves the open section on the right, beside "No settings match.".
  const page = matches(open) ? open : nav.flatMap((group) => group.pages)[0] ?? open;
  return (
    <Modal onClose={() => setOpen(false)}>
      <Modal.Content accessibleTitle={`Settings: ${page.label}`} title={page.label} description={page.description}
        sidebar={
          <div className="settings-nav contents">
            <SidebarPane label="Settings sections">
              <div className="w-44 shrink-0 md:mb-3 md:w-auto">
                <Input ref={search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings"
                  aria-label="Search settings" aria-keyshortcuts="/" title="Search settings (/)" />
              </div>
              {nav.every((group) => !group.pages.length) && <p role="status" className="no-match m-0 px-2 py-1 text-xs text-base-700">No settings match.</p>}
              {nav.map((group) => group.pages.length > 0 && (
                <SidebarNavigationGroup key={group.label} label={group.label}>
                  {group.pages.map((p) => (
                    <SidebarNavigationItem key={p.id} active={p.id === page.id} onClick={() => setSection(p.id)}>
                      {p.icon}<span>{p.label}</span>
                    </SidebarNavigationItem>
                  ))}
                </SidebarNavigationGroup>
              ))}
            </SidebarPane>
          </div>
        }>
        <Modal.Body>
          <div className="settings-body grid gap-7">
            {page.groups.map((g) => <GroupView group={g} key={g.title} />)}
          </div>
        </Modal.Body>
      </Modal.Content>
    </Modal>
  );
}

/**
 * Settings while it's open. It steps aside while a dialog its rows open is up (Edit, onboarding or Reset), since those
 * are T3 Copies whose focus trap the modal's would fight, and comes back on the same section when that one closes.
 */
export function SettingsDialog() {
  const open = useSettingsStore((state) => state.open);
  const editing = useEditStore((state) => state.edit !== null);
  const onboarding = useWizardStore((state) => state.run !== null);
  const resetting = useResetStore((state) => state.reset !== null);
  return open && !editing && !onboarding && !resetting ? <SettingsModal /> : null;
}
