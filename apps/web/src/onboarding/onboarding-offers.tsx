// An offer for each T3 project whose repository has .lar-factory.json on its default branch and isn't on this Mac's
// list; it opens the onboarding dialog with that project picked.

import { FileText } from 'lucide-react';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import { Button } from '@lar-factory/ui/button';
import { useBoardStore } from '../board/board-store.ts';
import { useWizardStore } from './wizard-store.ts';

export function OnboardingOffers() {
  const offers = useBoardStore((state) => state.data.onboardingOffers);
  const start = useWizardStore((s) => s.start);
  if (!offers?.length) return null;
  return (
    <div className="grid w-full gap-2 text-left">
      {offers.map((offer) => (
        <Alert key={offer.repo} variant="info" data-onboarding-offer={offer.repo}><FileText />
          <AlertTitle>{offer.name} already has a Repository config</AlertTitle>
          <AlertDescription><p className="m-0">{offer.repo} has <code>.lar-factory.json</code> on its default branch. Onboarding reuses its answers.</p></AlertDescription>
          <AlertAction><Button size="xs" onClick={() => start(offer)}>Onboard {offer.name}</Button></AlertAction>
        </Alert>
      ))}
    </div>
  );
}
