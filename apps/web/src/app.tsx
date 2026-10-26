// The page, the control room: the window controls, the sidebar with the List, and the main area with the title bar,
// the banners, Your desk and the line, scoped to the repository the sidebar picked. While no t3 is found, the notice
// replaces the main area's content and the sidebar shows only its brand and Settings. Settings takes the main area's
// place, hiding the board rather than closing it, so Back finds it as it was.

import { boardSections, failedCheck, platformOf } from '@lar-factory/shared';
import { useBoardStore } from './board/board-store.ts';
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
  const items = scope ? data.items.filter((i) => platformOf(i, data.repos) === scope) : data.items;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid gap-7 px-6 py-5">
        <Banners />
        <Desk items={boardSections({ ...data, items }, now).needsYou} />
        <Line items={items} />
      </div>
    </div>
  );
}

export function App() {
  const t3 = useBoardStore((state) => failedCheck(state.data.tools, 't3'));
  // T3 Code not running is a banner; only a missing t3 replaces the main area.
  const missing = t3?.result === 'missing' ? t3 : undefined;
  const settings = useSettingsStore((state) => state.open);
  return (
    <SidebarLayout className="fixed inset-0 bg-(--background) text-(--foreground)" board={!missing}>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="contents" hidden={settings}>
          <TitleBar />
          {missing ? <T3Missing check={missing} /> : <Content />}
        </div>
        {settings && <SettingsMain />}
      </main>
      {/* Outside main, so the announcement sits apart from the page. */}
      <CopyStatus />
      <Toasts />
      <ItemDialog />
      <AbandonDialog />
    </SidebarLayout>
  );
}
