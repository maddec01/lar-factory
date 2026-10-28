// Reset's confirmation, then Cancel and Reset, with gh's message when Reset fails. For a repository still onboarding it
// says whether Reset closes the onboarding PR or only drops the onboarding; for an onboarded one, what the reset PR
// removes, what Reset drops from this Mac and what it leaves, and that it closes the open Edit PR while there is one,
// after the prototype's ResetDialog. On Azure DevOps it names Azure DevOps and tags, and says it abandons a PR.

import { useEffect, useRef, type ReactNode } from 'react';
import { onAzure, sameRepo, shownRepo } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Alert } from '@lar-factory/ui/design-system/Alert';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { useBoardStore } from '../board/board-store.ts';
import { prName } from '../onboarding/steps.tsx';
import { useResetStore } from './reset-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

/** "labels", or "tags" on Azure DevOps. */
const labels = (repo: string) => (onAzure(repo) ? 'tags' : 'labels');
const closes = (repo: string) => (onAzure(repo) ? 'abandons' : 'closes');
const leaves = (repo: string) => `leaves alone the T3 project and the ${onAzure(repo) ? "project's tags" : "repository's labels"}.`;

/** What Reset does to `repo`'s onboarding, which waits for `prUrl` while that PR is open, linking the PR. */
function resetDetail(repo: string, prUrl: string | null): ReactNode {
  return prUrl
    ? <>Reset {closes(repo)} {shownRepo(repo)}'s onboarding PR, <a className="whitespace-nowrap font-medium underline" href={prUrl} target="_blank" rel="noopener">{prName(prUrl)}</a>, and
      drops its onboarding from this Mac's list, with its Resume. It opens no PR, and {leaves(repo)}</>
    : `Reset drops ${shownRepo(repo)}'s onboarding from this Mac's list, with its Resume. It has no open PR to ${onAzure(repo) ? 'abandon' : 'close'}, so it changes nothing on ${onAzure(repo) ? 'Azure DevOps' : 'GitHub'}, and ${leaves(repo)}`;
}

/** What Reset does to an onboarded `repo`, which closes `editPr` first while that Edit PR is open. */
function OnboardedDetail({ repo, editPr }: { repo: string; editPr: string | undefined }) {
  return <>
    <span>Reset:</span>
    <ul className="m-0 grid list-disc gap-0.5 ps-5 [&_code]:whitespace-nowrap">
      {editPr && <li data-closes-edit-pr>{closes(repo)} its open Edit PR, <a className="whitespace-nowrap font-medium underline" href={editPr} target="_blank" rel="noopener">
        {prName(editPr)}</a>, so it can't bring <code>.lar-factory.json</code> back;</li>}
      <li>opens a PR that removes <code>.lar-factory.json</code>, the <code>## Agent skills</code> block and the <code>docs/agents/</code> files;</li>
      <li>drops {shownRepo(repo)} from this Mac's list and hides its items;</li>
      <li>makes others who onboarded {shownRepo(repo)} lose its Repository config once the PR merges.</li>
    </ul>
    <span>It leaves alone the T3 project and the {labels(repo)} and statuses on its items.</span>
  </>;
}

/**
 * Cancel, which takes focus once the dialog has opened, so Enter doesn't open GitHub through a PR link. The copied
 * Modal focuses its first tabbable element as it opens, so Cancel takes focus on the next task, after it.
 */
function CancelButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const timer = setTimeout(() => ref.current?.focus());
    return () => clearTimeout(timer);
  }, []);
  return <Button {...kind('other')} ref={ref} disabled={disabled} onClick={onClick}>Cancel</Button>;
}

export function ResetDialog() {
  const { reset, close, confirm } = useResetStore();
  const onboarding = useBoardStore((s) => s.data.onboarding);
  const repos = useBoardStore((s) => s.data.repos);
  if (!reset) return null;
  const progress = onboarding?.find((o) => sameRepo(o.repo, reset.repo))?.progress;
  const prUrl = progress?.prUrl && !progress.prClosed ? progress.prUrl : null;
  return (
    <Modal loading={reset.resetting} onClose={close}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
      <Modal.Content data-reset-dialog role="alertdialog" title={`Reset ${shownRepo(reset.repo)}?`} aria-describedby="reset-detail"
        closeOnOverlayClick={false} focusFirstField={false}>
        <Modal.Body>
          <div className="grid gap-3">
            <Text as="div" id="reset-detail" tone="muted" className="grid gap-2">
              {progress ? resetDetail(reset.repo, prUrl) : <OnboardedDetail repo={reset.repo} editPr={repos.find((r) => sameRepo(r.repo, reset.repo))?.editPr} />}
            </Text>
            {reset.error && <Alert tone="danger" title="Can't reset">{reset.error}</Alert>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <CancelButton disabled={reset.resetting} onClick={close} />
          <Button {...kind('main', 'danger')} loading={reset.resetting} onClick={() => void confirm()}>{reset.resetting ? 'Resetting…' : 'Reset'}</Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}
