// The page, the control room: the window controls, the sidebar with the List, and the main area with the title bar,
// a card for each repository still onboarding, the offers to onboard T3 projects that have a Repository config, the banners, Your desk and the line, scoped to the repository the
// sidebar picked. While no t3 is found, the notice replaces the main area's content and the sidebar shows only its
// brand and Settings; while no repository is onboarded or onboarding, the empty state offering onboarding replaces it. Settings opens as a modal
// over it all. The loading screen covers all of it
// until the server's first read has settled.

import { boardSections, failedCheck, inRepo, noneOnboarded } from '@lar-factory/shared';
import { useBoardStore } from './board/board-store.ts';
import { CopyStatus } from './copy/copy-button.tsx';
import { Desk } from './desk/desk.tsx';
import { ItemDialog } from './item-dialog/item-dialog.tsx';
import { AbandonDialog } from './items/abandon-dialog.tsx';
import { Line } from './line/line.tsx';
import { LoadingScreen } from './loading/loading-screen.tsx';
import { Banners } from './notices/banners.tsx';
import { Toasts } from './notices/toasts.tsx';
import { T3Missing } from './notices/tool-notices.tsx';
import { EmptyState } from './onboarding/empty-state.tsx';
import { OnboardingCards } from './onboarding/onboarding-cards.tsx';
import { OnboardingOffers } from './onboarding/onboarding-offers.tsx';
import { WizardDialog } from './onboarding/wizard-dialog.tsx';
import { EditDialog } from './repositories/edit-dialog.tsx';
import { ResetDialog } from './repositories/reset-dialog.tsx';
import { SettingsDialog } from './settings/settings.tsx';
import { SidebarLayout } from './sidebar/sidebar.tsx';
import { useSidebarStore } from './sidebar/sidebar-store.ts';
import { TitleBar } from './title-bar/title-bar.tsx';

function Content() {
  const { data, now } = useBoardStore();
  const scope = useSidebarStore((state) => state.scope);
  const items = scope ? data.items.filter((i) => inRepo(i, scope)) : data.items;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="grid gap-7 px-6 py-5">
        <OnboardingCards />
        <OnboardingOffers />
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
  const empty = useBoardStore((state) => noneOnboarded(state.data));
  return (
    <SidebarLayout className="fixed inset-0 bg-(--background) text-(--foreground)" board={!missing}>
      <main className="flex min-w-0 flex-1 flex-col">
        <TitleBar />
        {missing ? <T3Missing check={missing} /> : empty ? <EmptyState /> : <Content />}
      </main>
      {/* Outside main, so the announcement sits apart from the page. */}
      <CopyStatus />
      <Toasts />
      <ItemDialog />
      <SettingsDialog />
      <AbandonDialog />
      <WizardDialog />
      <EditDialog />
      <ResetDialog />
      <LoadingScreen />
    </SidebarLayout>
  );
}
