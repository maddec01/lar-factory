// Reset's confirmation for a repository still onboarding: it says whether Reset closes the onboarding PR or only drops
// the onboarding, then Cancel and Reset, with gh's message when the close fails.

import type { ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { sameRepo } from '@lar-factory/shared';
import { Alert, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import {
  AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle,
} from '@lar-factory/ui/alert-dialog';
import { Button } from '@lar-factory/ui/button';
import { useBoardStore } from '../board/board-store.ts';
import { prName } from '../onboarding/steps.tsx';
import { useResetStore } from './reset-store.ts';

const LEAVES = 'leaves alone the T3 project and the repository’s labels.';

/** What Reset does to `repo`'s onboarding, which waits for `prUrl` while that PR is open, linking the PR. */
function resetDetail(repo: string, prUrl: string | null): ReactNode {
  return prUrl
    ? <>Reset closes {repo}’s onboarding PR, <a className="font-medium underline" href={prUrl} target="_blank" rel="noopener">{prName(prUrl)}</a>, and
      drops its onboarding from this Mac’s list, with its Resume. It opens no PR, and {LEAVES}</>
    : `Reset drops ${repo}’s onboarding from this Mac’s list, with its Resume. It has no open PR to close, so it changes nothing on GitHub, and ${LEAVES}`;
}

export function ResetDialog() {
  const { reset, close, confirm } = useResetStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  const progress = reset && onboarding?.find((o) => sameRepo(o.repo, reset.repo))?.progress;
  const prUrl = progress?.prUrl && !progress.prClosed ? progress.prUrl : null;
  return (
    <AlertDialog open={!!reset} onOpenChange={(open) => !open && close()}>
      <AlertDialogPopup data-reset-dialog>
        {reset && (<>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {reset.repo}?</AlertDialogTitle>
            <AlertDialogDescription>{resetDetail(reset.repo, prUrl)}</AlertDialogDescription>
            {reset.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t reset</AlertTitle><AlertDescription>{reset.error}</AlertDescription></Alert>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose disabled={reset.resetting} render={<Button variant="outline" size="xs" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" size="xs" disabled={reset.resetting} onClick={() => void confirm()}>
              {reset.resetting ? <><LoaderCircle className="animate-spin" /> Resetting…</> : 'Reset'}</Button>
          </AlertDialogFooter>
        </>)}
      </AlertDialogPopup>
    </AlertDialog>
  );
}
