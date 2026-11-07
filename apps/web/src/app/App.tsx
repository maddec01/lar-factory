// The board shows onboarding in progress, Your desk and the stage lists, scoped to the repository the title
// bar or the List modal picked; a repository whose items the first read hasn't landed yet says it's reading instead
// of an empty desk and stages. While no t3 is found, the notice replaces the content and the title bar shows only its
// brand and Settings; while no repository is onboarded or onboarding, the empty state offering onboarding replaces
// it. Settings opens as a modal over it all. The loading screen covers all of it until the server's first read has
// settled. Later reads keep the loaded board visible. Every screen shares the notification stack.

import { failedCheck, inRepo, noneOnboarded, stillReading } from '@lar-factory/shared';
import { TooltipProvider } from '@lar-works/design-system';

import { LoadingScreen } from './shell/loading/LoadingScreen';
import { TitleBar } from './shell/title-bar/TitleBar';
import { Desk } from '@/features/desk/Desk';
import { useShownScope } from '@/features/filters/ScopeStore';
import { ItemDialog } from '@/features/item-dialog/ItemDialog';
import { AbandonDialog } from '@/features/items/AbandonDialog';
import { StageLayout } from '@/features/line/StageLayout';
import { NotificationStack } from '@/features/notices/Toasts';
import { T3Missing } from '@/features/notices/ToolNotices';
import { Warnings } from '@/features/notices/Warnings';
import { EmptyState } from '@/features/onboarding/EmptyState';
import { OnboardingCards } from '@/features/onboarding/OnboardingCards';
import { WizardDialog } from '@/features/onboarding/WizardDialog';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { useBoardStore } from '@/services/board/board.hooks';
import { CopyStatus } from '@/shared/ui/copy/CopyButton';
import { Loader } from '@/shared/ui/loading/Loader';

function Content() {
    const data = useBoardStore((state) => state.data);
    const loaded = useBoardStore((state) => state.loaded);
    const scope = useShownScope();
    const items = scope ? data.items.filter((i) => inRepo(i, scope)) : data.items;

    return (
        // Everything under the title bar scrolls as one page, and nothing in it shrinks to fit.
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 pt-3 pb-4 *:shrink-0">
            <OnboardingCards />
            {scope && !loaded && stillReading(data, scope) ? (
                <p className="text-base-700 m-0 flex items-center justify-center gap-2 p-6 text-sm" data-reading>
                    <Loader label="Loading Projects…" className="size-4" />
                </p>
            ) : (
                <StageLayout items={items} desk={<Desk items={items} />} />
            )}
        </div>
    );
}

export function App() {
    const t3 = useBoardStore((state) => failedCheck(state.data.tools, 't3'));
    // T3 Code not running is a warning; only a missing t3 replaces the main area.
    const missing = t3?.result === 'missing' ? t3 : undefined;
    const empty = useBoardStore((state) => noneOnboarded(state.data));

    return (
        // The design system's Tooltip needs a provider above it.
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
                <LoadingScreen />
            </div>
        </TooltipProvider>
    );
}
