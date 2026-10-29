// The warning for an onboarded repository the board left off because its .lar-factory.json couldn't be read,
// in repo-config.sh's words.

import { sameRepo, shownRepo, type RepositoryConfigProblem } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useBoardStore } from '../board/board-store.ts';
import { useWizardStore } from '../onboarding/wizard-store.ts';
import { REPLACE_SETTINGS_HELP } from '../onboarding/setup-answers.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { AddingARepository } from './adding-a-repository.tsx';
import { Warning } from './warning.tsx';

export function RepositoryConfigWarning({ repo, problem }: RepositoryConfigProblem) {
  const offer = useBoardStore((state) => state.data.onboardingOffers?.find((choice) => sameRepo(choice.repo, repo)));
  const start = useWizardStore((state) => state.start);
  const dismissKey = `repository-config:${repo.toLowerCase()}`;
  if (offer?.configProblem) return <Warning dismissKey={dismissKey} title={`${shownRepo(repo)} needs setup`} action={<Button {...kind('other')} onClick={() => start(offer)}>Run onboarding</Button>}>
    {REPLACE_SETTINGS_HELP}
  </Warning>;
  return (
    <Warning dismissKey={dismissKey} title={`${shownRepo(repo)} is off the board.`}>
      {problem.charAt(0).toUpperCase() + problem.slice(1)} <AddingARepository /> The board reads it again on each refresh.
    </Warning>
  );
}
