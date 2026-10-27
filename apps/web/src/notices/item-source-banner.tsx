// The banner for an onboarded repository whose items the latest read left off, such as one reading through a
// logged-out az, with the command that fixes it when one does.

import type { ItemSourceProblem } from '@lar-factory/shared';
import { Banner } from './banner.tsx';
import { CopyableCommand } from './tool-notices.tsx';

export function ItemSourceBanner({ repo, problem, fix }: ItemSourceProblem) {
  return (
    <Banner title={`${repo}'s items are off the board.`}>
      {problem} {fix && <>Run <CopyableCommand command={fix} /> in a terminal. </>}The board reads it again on each refresh.
    </Banner>
  );
}
