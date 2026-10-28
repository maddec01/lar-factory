// The page, the control room: the title bar, then a card for each repository still onboarding, the offers to onboard
// T3 projects that have a Repository config, the banners, Your desk and the line, scoped to the repository the title
// bar or the List modal picked. While no t3 is found, the notice replaces the content and the title bar shows only its
// brand and Settings; while no repository is onboarded or onboarding, the empty state offering onboarding replaces
// it. Settings opens as a modal over it all. The loading screen covers all of it until the server's first read has
// settled.

import { boardSections, failedCheck, inRepo, noneOnboarded } from '@lar-factory/shared';
import { Notifications } from '@lar-factory/ui/design-system/Notifications';
import { TooltipProvider } from '@lar-factory/ui/design-system/Tooltip';
import { useBoardStore } from './board/board-store.ts';
import { useScopeStore } from './board/scope-store.ts';
import { CopyStatus } from './copy/copy-button.tsx';
import { Desk } from './desk/desk.tsx';
import { ItemDialog } from './item-dialog/item-dialog.tsx';
import { AbandonDialog } from './items/abandon-dialog.tsx';
import { Line } from './line/line.tsx';
import { LoadingScreen } from './loading/loading-screen.tsx';
import { Banners } from './notices/banners.tsx';
import { T3Missing } from './notices/tool-notices.tsx';
import { EmptyState } from './onboarding/empty-state.tsx';
import { OnboardingCards } from './onboarding/onboarding-cards.tsx';
import { OnboardingOffers } from './onboarding/onboarding-offers.tsx';
import { WizardDialog } from './onboarding/wizard-dialog.tsx';
import { EditDialog } from './repositories/edit-dialog.tsx';
import { ResetDialog } from './repositories/reset-dialog.tsx';
import { SettingsDialog } from './settings/settings.tsx';
import { TitleBar } from './title-bar/title-bar.tsx';
import { prototype525 } from './title-bar/prototype-525-state.ts';
import { PrototypeSwitcher } from './title-bar/prototype-525-switcher.tsx';
import { PrototypeWorkArea } from './title-bar/prototype-525-title-bar.tsx';

function Content() {
  const { data, now } = useBoardStore();
  const scope = useScopeStore((state) => state.scope);
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
    // The copied Tooltip needs a provider above it.
    <TooltipProvider>
      <div className="fixed inset-0 flex flex-col bg-(--background) text-(--foreground)">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TitleBar />
          {prototype525
            ? <PrototypeWorkArea>{missing ? <T3Missing check={missing} /> : empty ? <EmptyState /> : <Content />}</PrototypeWorkArea>
            : missing ? <T3Missing check={missing} /> : empty ? <EmptyState /> : <Content />}
        </main>
        {/* Outside main, so the announcement sits apart from the page. */}
        <CopyStatus />
        <Notifications />
        <ItemDialog />
        <SettingsDialog />
        <AbandonDialog />
        <WizardDialog />
        <EditDialog />
        <ResetDialog />
        <LoadingScreen />
        {prototype525 && <PrototypeSwitcher />}
      </div>
    </TooltipProvider>
  );
}
