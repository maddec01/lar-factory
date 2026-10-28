// The board's main area while no repository is on this Mac's list: it says so and offers Onboard a repository, and
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
        <h2 className="m-0 text-lg font-semibold">No repository is onboarded yet</h2>
        <p className="m-0 text-sm text-base-700">Onboarding connects a repository and its T3 project to the board: it picks the item source, checks the commands the factory runs, and opens one PR that adds the Repository config.</p>
        <Button {...kind('other')} onClick={() => start()} data-onboard>Onboard a repository</Button>
        <OnboardingOffers />
      </div>
    </div>
  );
}
