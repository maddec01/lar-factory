// An offer for each T3 project whose repository has .lar-factory.json on its default branch and isn't on this Mac's
// list; it opens the onboarding dialog with that project picked.

import { useId, useState } from 'react';
import { shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { useBoardStore } from '../board/board-store.ts';
import { useWizardStore } from './wizard-store.ts';
import { REPLACE_SETTINGS_HELP } from './setup-answers.ts';
import { kind } from '../buttons/button-kinds.tsx';

export function OnboardingOffers() {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const offers = useBoardStore((state) => state.data.onboardingOffers);
  const start = useWizardStore((s) => s.start);
  if (!offers?.length) return null;
  return (
    <div className="grid w-full gap-2 text-left" data-onboarding-offers>
      {offers.length > 1 && <Alert tone="info" role="note" title={`Add ${offers.length} repositories`}
        action={<Button {...kind('other')} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide repositories' : 'Show repositories'}</Button>} />}
      <div id={listId} className="grid gap-2">
        {(offers.length === 1 || expanded) && offers.map((offer) => (
          <Alert key={offer.repo} tone="info" role="note" data-onboarding-offer={offer.repo} title={offer.configProblem ? `${offer.name} needs setup` : `${offer.name} has saved board settings`}
            action={<Button {...kind('other')} onClick={() => start(offer)}>{offer.configProblem ? 'Set up' : 'Add'} {offer.name}</Button>}>
            {offer.configProblem ? REPLACE_SETTINGS_HELP : <>{shownRepo(offer.repo)} keeps its settings in <code>.lar-factory.json</code>. Setup will reuse them.</>}
          </Alert>
        ))}
      </div>
    </div>
  );
}
