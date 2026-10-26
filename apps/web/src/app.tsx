// The page, the control room: the window controls, the sidebar with the List, and the main area with the title bar,
// the banners, Your desk and the line, scoped to the repository the sidebar picked. While no t3 is found, the notice
// replaces the main area's content and the sidebar shows only its brand and Settings. Settings takes the main area's
// place, hiding the board rather than closing it, so Back finds it as it was.

import { boardSections, platformOf } from '@lar-factory/shared';
import { useBoardStore } from './board/board-store.ts';
import { BoardSlot, EmptyState, PrototypeSwitcher } from './onboarding-prototype/board.tsx';
import { Takeover, WizardDialog } from './onboarding-prototype/variants.tsx';
import { PROTOTYPE, useHasOnboarded, useWizardStore } from './onboarding-prototype/wizard-store.ts';
import { CopyStatus } from './copy/copy-button.tsx';
import { Desk } from './desk/desk.tsx';
import { ItemDialog } from './item-dialog/item-dialog.tsx';
import { AbandonDialog } from './items/abandon-dialog.tsx';
import { Line } from './line/line.tsx';
import { Banners } from './notices/banners.tsx';
import { Toasts } from './notices/toasts.tsx';
import { T3Missing } from './notices/tool-notices.tsx';
import { SettingsMain } from './settings/settings.tsx';
import { useSettingsStore } from './settings/settings-store.ts';
import { SidebarLayout } from './sidebar/sidebar.tsx';
import { useSidebarStore } from './sidebar/sidebar-store.ts';
import { TitleBar } from './title-bar/title-bar.tsx';

function Content() {
  const { data, now } = useBoardStore();
  const scope = useSidebarStore((state) => state.scope);
  const resetRepos = useWizardStore((state) => state.resetRepos);
  const all = PROTOTYPE ? data.items.filter((i) => !i.repo || !resetRepos.includes(i.repo)) : data.items;
  const items = scope ? all.filter((i) => platformOf(i, data.repos) === scope) : all;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid gap-7 px-6 py-5">
        {PROTOTYPE && <BoardSlot />}
        <Banners />
        <Desk items={boardSections({ ...data, items }, now).needsYou} />
        <Line items={items} />
      </div>
    </div>
  );
}

export function App() {
  const t3 = useBoardStore((state) => state.data.tools?.t3);
  const settings = useSettingsStore((state) => state.open);
  // PROTOTYPE (#363): the onboarding wizard's empty board, variant A's takeover, B's dialog and the switcher.
  const onboarded = useHasOnboarded();
  const empty = PROTOTYPE && !onboarded;
  const takeover = useWizardStore((state) => PROTOTYPE && state.variant === 'A' && !!state.run) && !settings;
  return (
    <SidebarLayout className="fixed inset-0 bg-(--background) text-(--foreground)" board={!t3 && !empty}>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="contents" hidden={settings || takeover}>
          <TitleBar />
          {t3 ? <T3Missing problem={t3} /> : empty ? <EmptyState /> : <Content />}
        </div>
        {settings && <SettingsMain />}
        {takeover && <Takeover />}
      </main>
      {PROTOTYPE && <><WizardDialog /><PrototypeSwitcher /></>}
      {/* Outside main, so the announcement sits apart from the page. */}
      <CopyStatus />
      <Toasts />
      <ItemDialog />
      <AbandonDialog />
    </SidebarLayout>
  );
}
