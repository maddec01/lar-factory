// The board's main area while no repository is on this Mac's list: it says so and offers Onboard a repository.

import { Plus } from 'lucide-react';
import { Button } from '@lar-factory/ui/button';
import { BrandMark } from '../brand/brand-mark.tsx';
import { useWizardStore } from './wizard-store.ts';

export function EmptyState() {
  const start = useWizardStore((s) => s.start);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-empty-state>
      <div className="mx-auto grid max-w-xl justify-items-center gap-3 px-6 py-16 text-center">
        <span className="grid size-12 place-items-center rounded-xl border bg-card"><BrandMark className="h-6" /></span>
        <h2 className="m-0 text-lg font-semibold">No repository is onboarded yet</h2>
        <p className="m-0 text-sm text-muted-foreground">Onboarding connects a repository and its T3 project to the board: it picks the item source, checks the commands the factory runs, and opens one PR that adds the Repository config.</p>
        <Button onClick={start} data-onboard><Plus /> Onboard a repository</Button>
      </div>
    </div>
  );
}
