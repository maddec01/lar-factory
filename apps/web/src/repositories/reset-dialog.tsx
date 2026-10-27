// Reset's confirmation, then Cancel and Reset, with gh's message when Reset fails. For a repository still onboarding it
// says whether Reset closes the onboarding PR or only drops the onboarding; for an onboarded one, what the reset PR
// removes, what Reset drops from this Mac and what it leaves, and that it closes the open Edit PR while there is one,
// after the prototype's ResetDialog. On Azure DevOps it names Azure DevOps and tags, and says it abandons a PR.

import { useRef, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle } from 'lucide-react';
import { onAzure, sameRepo, shownRepo } from '@lar-factory/shared';
import { Alert, AlertDescription, AlertTitle } from '@lar-factory/ui/alert';
import {
  AlertDialog, AlertDialogClose, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogPopup, AlertDialogTitle,
} from '@lar-factory/ui/alert-dialog';
import { Button } from '@lar-factory/ui/button';
import { useBoardStore } from '../board/board-store.ts';
import { prName } from '../onboarding/steps.tsx';
import { useResetStore } from './reset-store.ts';

/** "labels", or "tags" on Azure DevOps. */
const labels = (repo: string) => (onAzure(repo) ? 'tags' : 'labels');
const closes = (repo: string) => (onAzure(repo) ? 'abandons' : 'closes');
const leaves = (repo: string) => `leaves alone the T3 project and the ${onAzure(repo) ? 'project’s tags' : 'repository’s labels'}.`;

/** What Reset does to `repo`'s onboarding, which waits for `prUrl` while that PR is open, linking the PR. */
function resetDetail(repo: string, prUrl: string | null): ReactNode {
  return prUrl
    ? <>Reset {closes(repo)} {shownRepo(repo)}’s onboarding PR, <a className="whitespace-nowrap font-medium underline" href={prUrl} target="_blank" rel="noopener">{prName(prUrl)}</a>, and
      drops its onboarding from this Mac’s list, with its Resume. It opens no PR, and {leaves(repo)}</>
    : `Reset drops ${shownRepo(repo)}’s onboarding from this Mac’s list, with its Resume. It has no open PR to ${onAzure(repo) ? 'abandon' : 'close'}, so it changes nothing on ${onAzure(repo) ? 'Azure DevOps' : 'GitHub'}, and ${leaves(repo)}`;
}

/** What Reset does to an onboarded `repo`, which closes `editPr` first while that Edit PR is open. */
function OnboardedDetail({ repo, editPr }: { repo: string; editPr: string | undefined }) {
  return <>
    <span>Reset:</span>
    <ul className="m-0 grid list-disc gap-0.5 ps-5 [&_code]:whitespace-nowrap">
      {editPr && <li data-closes-edit-pr>{closes(repo)} its open Edit PR, <a className="whitespace-nowrap font-medium underline" href={editPr} target="_blank" rel="noopener">
        {prName(editPr)}</a>, so it can’t bring <code>.lar-factory.json</code> back;</li>}
      <li>opens a PR that removes <code>.lar-factory.json</code>, the <code>## Agent skills</code> block and the <code>docs/agents/</code> files;</li>
      <li>drops {shownRepo(repo)} from this Mac’s list and hides its items;</li>
      <li>makes others who onboarded {shownRepo(repo)} lose its Repository config once the PR merges.</li>
    </ul>
    <span>It leaves alone the T3 project and the {labels(repo)} and statuses on its items.</span>
  </>;
}

export function ResetDialog() {
  const { reset, close, confirm } = useResetStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  const repos = useBoardStore((s) => s.data.repos);
  const progress = reset && onboarding?.find((o) => sameRepo(o.repo, reset.repo))?.progress;
  const prUrl = progress?.prUrl && !progress.prClosed ? progress.prUrl : null;
  // Focus starts on Cancel, not a PR link, so Enter doesn't open GitHub.
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={!!reset} onOpenChange={(open) => !open && close()}>
      <AlertDialogPopup data-reset-dialog initialFocus={cancel}>
        {reset && (<>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {shownRepo(reset.repo)}?</AlertDialogTitle>
            {progress ? <AlertDialogDescription>{resetDetail(reset.repo, prUrl)}</AlertDialogDescription>
              : <AlertDialogDescription render={<div />} className="grid gap-2 text-start"><OnboardedDetail repo={reset.repo}
                editPr={repos.find((r) => sameRepo(r.repo, reset.repo))?.editPr} /></AlertDialogDescription>}
            {reset.error && <Alert variant="error"><CircleAlert /><AlertTitle>Can’t reset</AlertTitle><AlertDescription>{reset.error}</AlertDescription></Alert>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose ref={cancel} disabled={reset.resetting} render={<Button variant="outline" size="xs" />}>Cancel</AlertDialogClose>
            <Button variant="destructive" size="xs" disabled={reset.resetting} onClick={() => void confirm()}>
              {reset.resetting ? <><LoaderCircle className="animate-spin" /> Resetting…</> : 'Reset'}</Button>
          </AlertDialogFooter>
        </>)}
      </AlertDialogPopup>
    </AlertDialog>
  );
}
