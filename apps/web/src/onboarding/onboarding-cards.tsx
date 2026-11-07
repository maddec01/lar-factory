// A card above the board for each repository still onboarding: its name, the step it stopped at or its PR's wait for
// the merge, and Resume, which reopens the onboarding dialog there.

import { shownRepo } from '@lar-factory/shared';
import { Button, Badge, NoticeCard } from '@lar-works/design-system';
import { useBoardStore } from '../board/board-store.ts';
import { stoppedAt, useWizardStore } from './wizard-store.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { ProjectIcon } from '../repositories/project-icon.tsx';

export function OnboardingCards() {
  const onboarding = useBoardStore((state) => state.data.onboarding);
  const resume = useWizardStore((s) => s.resume);
  if (!onboarding?.length) return null;
  return (
    <div className="grid max-h-[35%] shrink-0 gap-2 overflow-y-auto">
      {onboarding.map(({ repo, progress }) => {
        const where = stoppedAt(progress);
        return (
          <div key={repo} data-onboarding-card={repo}>
            <NoticeCard tone="warning" icon={<ProjectIcon repo={repo} size="medium" />} title={shownRepo(repo)} badge={<Badge tone="warning">Setting up</Badge>}
              description={`${where[0]!.toUpperCase()}${where.slice(1)}`} actions={<Button {...kind('other')} onClick={() => resume(repo)} data-resume>Resume</Button>} />
          </div>
        );
      })}
    </div>
  );
}
