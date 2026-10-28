// A card above the board for each repository still onboarding: its name, the step it stopped at or its PR's wait for
// the merge, and Resume, which reopens the onboarding dialog there.

import { FolderGit2 } from 'lucide-react';
import { shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { NoticeCard } from '@lar-factory/ui/design-system/NoticeCard';
import { useBoardStore } from '../board/board-store.ts';
import { stoppedAt, useWizardStore } from './wizard-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

export function OnboardingCards() {
  const onboarding = useBoardStore((state) => state.data.onboarding);
  const resume = useWizardStore((s) => s.resume);
  if (!onboarding?.length) return null;
  return (
    <div className="grid gap-2">
      {onboarding.map(({ repo, progress }) => {
        const where = stoppedAt(progress);
        return (
          <div key={repo} data-onboarding-card={repo}>
            <NoticeCard tone="warning" icon={<FolderGit2 />} title={shownRepo(repo)} badge={<Badge tone="warning">Onboarding</Badge>}
              description={`${where[0]!.toUpperCase()}${where.slice(1)}`} actions={<Button {...kind('other')} onClick={() => resume(repo)} data-resume>Resume</Button>} />
          </div>
        );
      })}
    </div>
  );
}
