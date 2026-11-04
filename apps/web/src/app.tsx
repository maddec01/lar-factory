// The board shows onboarding in progress, Your desk and the stage lists, scoped to the repository the title
// bar or the List modal picked; a repository whose items the first read hasn't landed yet says it's reading instead
// of an empty desk and stages. While no t3 is found, the notice replaces the content and the title bar shows only its
// brand and Settings; while no repository is onboarded or onboarding, the empty state offering onboarding replaces
// it. Settings opens as a modal over it all. The loading screen covers all of it until the server's first read has
// settled. Later reads keep the loaded board visible. Every screen shares the notification stack.

import { failedCheck, inRepo, noneOnboarded, stillReading } from '@lar-factory/shared';
import { TooltipProvider } from '@lar-factory/ui/design-system/Tooltip';
import { useBoardStore } from './board/board-store.ts';
import { useShownScope } from './board/scope-store.ts';
import { CopyStatus } from './copy/copy-button.tsx';
import { Desk } from './desk/desk.tsx';
import { ItemDialog } from './item-dialog/item-dialog.tsx';
import { AbandonDialog } from './items/abandon-dialog.tsx';
import { StageLayout } from './line/stage-layout.tsx';
import { Loader } from './loading/loader.tsx';
import { LoadingScreen } from './loading/loading-screen.tsx';
import { Warnings } from './notices/warnings.tsx';
import { T3Missing } from './notices/tool-notices.tsx';
import { NotificationStack } from './notices/toasts.tsx';
import { EmptyState } from './onboarding/empty-state.tsx';
import { OnboardingCards } from './onboarding/onboarding-cards.tsx';
import { WizardDialog } from './onboarding/wizard-dialog.tsx';
import { EditDialog } from './repositories/edit-dialog.tsx';
import { SettingsDialog } from './settings/settings.tsx';
import { TitleBar } from './title-bar/title-bar.tsx';

function Content() {
  const data = useBoardStore((state) => state.data);
  const loaded = useBoardStore((state) => state.loaded);
  const scope = useShownScope();
  const items = scope ? data.items.filter((i) => inRepo(i, scope)) : data.items;
  return (
    // Everything under the title bar scrolls as one page, and nothing in it shrinks to fit.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pb-4 pt-3 *:shrink-0">
      <OnboardingCards />
      {scope && !loaded && stillReading(data, scope)
        ? <p className="m-0 flex items-center justify-center gap-2 p-6 text-sm text-base-700" data-reading><Loader label="Loading projects…" className="size-4" /></p>
        : <StageLayout items={items} desk={<Desk items={items} />} />}
    </div>
  );
}

export function App() {
  const t3 = useBoardStore((state) => failedCheck(state.data.tools, 't3'));
  // T3 Code not running is a warning; only a missing t3 replaces the main area.
  const missing = t3?.result === 'missing' ? t3 : undefined;
  const empty = useBoardStore((state) => noneOnboarded(state.data));
  return (
    // The copied Tooltip needs a provider above it.
    <TooltipProvider>
      <div className="fixed inset-0 flex flex-col bg-(--background) text-(--foreground)">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TitleBar />
          <Warnings />
          {missing ? <T3Missing check={missing} /> : empty ? <EmptyState /> : <Content />}
        </main>
        {/* Outside main, so the announcement sits apart from the page. */}
        <CopyStatus />
        <NotificationStack />
        <ItemDialog />
        <SettingsDialog />
        <AbandonDialog />
        <WizardDialog />
        <EditDialog />
        <LoadingScreen />
      </div>
    </TooltipProvider>
  );
}
