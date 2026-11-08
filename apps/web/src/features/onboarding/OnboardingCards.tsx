// A card above the board for each repository still onboarding: its name, the step it stopped at or its PR's wait for
// the merge, and Resume, which reopens the onboarding dialog there.

import { shownRepo } from '@lar-factory/shared';
import { Badge, Button, NoticeCard } from '@lar-works/design-system';

import { stoppedAt, useWizardStore } from './WizardStore';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { buttonKind, SetupCardList } from '@/ui/board';

export function OnboardingCards() {
    const onboarding = useBoardStore((state) => state.data.onboarding);
    const resume = useWizardStore((s) => s.resume);

    if (!onboarding?.length) return null;

    return (
        <SetupCardList>
            {onboarding.map(({ repo, progress }) => {
                const where = stoppedAt(progress);

                return (
                    <div key={repo} data-onboarding-card={repo}>
                        <NoticeCard
                            tone="warning"
                            icon={<ProjectIcon repo={repo} size="lg" />}
                            title={shownRepo(repo)}
                            badge={<Badge tone="warning">Setting up</Badge>}
                            description={`${where[0]!.toUpperCase()}${where.slice(1)}`}
                            actions={
                                <Button {...buttonKind('other')} onClick={() => resume(repo)} data-resume>
                                    Resume
                                </Button>
                            }
                        />
                    </div>
                );
            })}
        </SetupCardList>
    );
}
