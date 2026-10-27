// An offer for each T3 project whose repository has .lar-factory.json on its default branch and isn't on this Mac's
// list; it opens the onboarding dialog with that project picked.

import { shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { useBoardStore } from '../board/board-store.ts';
import { useWizardStore } from './wizard-store.ts';

export function OnboardingOffers() {
  const offers = useBoardStore((state) => state.data.onboardingOffers);
  const start = useWizardStore((s) => s.start);
  if (!offers?.length) return null;
  return (
    <div className="grid w-full gap-2 text-left">
      {offers.map((offer) => (
        <Alert key={offer.repo} tone="info" role="note" data-onboarding-offer={offer.repo} title={`${offer.name} already has a Repository config`}
          action={<Button onClick={() => start(offer)}>Onboard {offer.name}</Button>}>
          {shownRepo(offer.repo)} has <code>.lar-factory.json</code> on its default branch. Onboarding reuses its answers.
        </Alert>
      ))}
    </div>
  );
}
