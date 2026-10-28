// The board's main area while no repository is on this Mac's list: it says so and offers Add a repository, and
// the offers for T3 projects that have a Repository config.

import { Button } from '@lar-factory/ui/design-system/Button';
import { BrandMark } from '@lar-factory/ui/design-system/BrandMark';
import { OnboardingOffers } from './onboarding-offers.tsx';
import { useWizardStore } from './wizard-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

export function EmptyState() {
  const start = useWizardStore((s) => s.start);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-empty-state>
      <div className="mx-auto grid max-w-xl justify-items-center gap-3 px-6 py-16 text-center">
        <BrandMark label="lar" />
        <h2 className="m-0 text-lg font-semibold">Add your first repository</h2>
        <p className="m-0 text-sm text-base-700">Connect a repository to see its work and start agents from this board.</p>
        <Button {...kind('other')} onClick={() => start()} data-onboard>Add a repository</Button>
        <OnboardingOffers />
      </div>
    </div>
  );
}
