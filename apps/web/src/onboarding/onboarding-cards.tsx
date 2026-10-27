// A card above the board for each repository still onboarding: its name, the step it stopped at or its PR's wait for
// the merge, and Resume, which reopens the onboarding dialog there.

import { FolderGit2 } from 'lucide-react';
import { shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Card } from '@lar-factory/ui/card';
import { useBoardStore } from '../board/board-store.ts';
import { stoppedAt, useWizardStore } from './wizard-store.ts';

export function OnboardingCards() {
  const onboarding = useBoardStore((state) => state.data.onboarding);
  const resume = useWizardStore((s) => s.resume);
  if (!onboarding?.length) return null;
  return (
    <div className="grid gap-2">
      {onboarding.map(({ repo, progress }) => {
        const where = stoppedAt(progress);
        return (
          <Card key={repo} accent className="flex-row flex-wrap items-center gap-3" data-onboarding-card={repo}>
            <FolderGit2 className="size-4 text-base-700" />
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-2 text-sm font-medium"><span data-repo>{shownRepo(repo)}</span><Badge tone="warning">Onboarding</Badge></span>
              <span className="text-xs text-base-700">{where[0]!.toUpperCase()}{where.slice(1)}</span>
            </div>
            <Button onClick={() => resume(repo)} data-resume>Resume</Button>
          </Card>
        );
      })}
    </div>
  );
}
