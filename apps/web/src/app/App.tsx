// The board shows onboarding in progress, Your desk and the stage lists, scoped to the repository the title
// bar or the list modal picked; a repository whose items the first read hasn't landed yet says it's reading instead
// of an empty desk and stages. While no t3 is found, the notice replaces the content and the title bar shows only its
// brand and Settings; while no repository is onboarded or onboarding, the empty state offering onboarding replaces
// it. Settings opens as a modal over it all. The loading screen covers all of it until the server's first read has
// settled. Later reads keep the loaded board visible. Every screen shares the design system's notifications.

import { failedCheck, inMacApp, inRepo, noneOnboarded, stillReading } from '@lar-factory/shared';
import { Notifications } from '@lar-works/design-system';

import { LoadingScreen } from './shell/loading/LoadingScreen';
import { TitleBar } from './shell/title-bar/TitleBar';
import { useLightsHidden } from './shell/title-bar/WindowControls';
import { Desk } from '@/features/desk';
import { useShownScope } from '@/features/filters';
import { ItemDialog } from '@/features/item-dialog';
import { AbandonDialog } from '@/features/items';
import { StageLayout } from '@/features/line';
import { T3Missing, Warnings } from '@/features/notices';
import { EmptyState, OnboardingCards, WizardDialog } from '@/features/onboarding';
import { SettingsDialog } from '@/features/settings';
import { useBoardStore } from '@/services/board/board.hooks';
import { CopyStatus } from '@/shared/copy/CopyButton';
import { BoardContent, BoardShell, ReadingLine } from '@/ui/board';

function Content() {
    const data = useBoardStore((state) => state.data);
    const loaded = useBoardStore((state) => state.loaded);
    const scope = useShownScope();
    const items = scope ? data.items.filter((i) => inRepo(i, scope)) : data.items;

    return (
        <BoardContent>
            <OnboardingCards />
            {scope && !loaded && stillReading(data, scope) ? (
                <ReadingLine label="Loading projects…" />
            ) : (
                <StageLayout items={items} desk={<Desk items={items} />} />
            )}
        </BoardContent>
    );
}

export function App() {
    const t3 = useBoardStore((state) => failedCheck(state.data.tools, 't3'));
    // T3 Code not running is a warning; only a missing t3 replaces the main area.
    const missing = t3?.result === 'missing' ? t3 : undefined;
    const empty = useBoardStore((state) => noneOnboarded(state.data));
    const lightsHidden = useLightsHidden();

    return (
        <BoardShell
            header={<TitleBar />}
            // The missing-t3 notice has its own heading.
            heading={missing ? undefined : 'Lar Factory'}
            trafficLights={inMacApp() && !lightsHidden}
            overlays={
                <>
                    <CopyStatus />
                    {/* The design system's one toast system on every screen, above every dialog. It portals outside
                        the board, which is inert while the loading screen covers it. */}
                    <Notifications />
                    <ItemDialog />
                    <SettingsDialog />
                    <AbandonDialog />
                    <WizardDialog />
                    <LoadingScreen />
                </>
            }
        >
            <Warnings />
            {missing ? <T3Missing check={missing} /> : empty ? <EmptyState /> : <Content />}
        </BoardShell>
    );
}
