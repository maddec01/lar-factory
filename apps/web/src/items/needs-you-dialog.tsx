// A Needs you choice's confirmation: what it will do, the recovery and cleanup choices it needs, and any failure, which
// stays here to retry or cancel. Opening it only reads; a write waits for a press inside it.

import { useEffect, useRef, useState } from 'react';
import { needsYouPrompt } from '@lar-factory/shared';
import type { BoardData, Item, NeedsYouAction } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { Modal } from '@lar-factory/ui/design-system/Modal';
import { Text } from '@lar-factory/ui/design-system/Typography';
import { useActionStore, useItemAction } from './action-store.ts';
import { inspectRecovery, postAction, receive, resolveNeedsYou, startAgain } from './card-actions.ts';
import type { ActionResult, RecoveryInspection } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { StartEntries } from './start-control.tsx';
import { kind } from '../buttons/button-kinds.tsx';

interface Props {
  item: Item;
  data: BoardData;
  offer: NeedsYouAction;
  label: string;
  onClose: () => void;
}

export function NeedsYouDialog({ item, data, offer, label, onClose }: Props) {
  const prompt = needsYouPrompt(item, offer);
  const state = writeState(data, useItemAction(item.id));
  const inspects = offer === 'start-again' && item.needsYou?.startAgainPurpose === 'build';
  const moving = offer === 'back-to-queue' || offer === 'back-to-list';
  const [inspection, setInspection] = useState<RecoveryInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleanup, setCleanup] = useState<{ token: string; plans: CleanupPlan[] } | null>(null);
  const [next, setNext] = useState<(() => Promise<ActionResult | undefined>) | null>(null);
  const [local, setLocal] = useState(false);
  const [remote, setRemote] = useState(false);
  const [confirmLoss, setConfirmLoss] = useState(false);
  const checking = inspects && !inspection && !error;
  const held = state.disabled || loading;
  const dismiss = () => { if (!loading) onClose(); };

  async function inspect() {
    setError(null);
    const result = await inspectRecovery(item.id);
    if (result.error || !result.inspection) setError(result.error ?? 'Cannot inspect recovery.');
    else setInspection(result.inspection);
  }
  // StrictMode starts an effect twice, and one read answers for both.
  const inspected = useRef(false);
  useEffect(() => {
    if (!inspects || inspected.current) return;
    inspected.current = true;
    void inspect();
  }, []);

  async function finish(run: () => Promise<ActionResult | undefined>, selection?: { token: string; local: boolean; remote: boolean; confirmedLoss: boolean }) {
    setLoading(true);
    setError(null);
    try {
      const result = await run();
      if (!result) return;
      if (result.error || ('uncertain' in result && result.uncertain)) { setError(result.error); return; }
      if (selection) {
        const cleaned = await postAction<{ errors: string[]; remainingBranches: string[] }>('/api/execute-owned-cleanup', { itemId: item.id, options: selection });
        receive(cleaned);
        const message = [cleaned.error, ...cleaned.errors ?? [], cleaned.remainingBranches?.length ? `Branches remain for you to remove: ${cleaned.remainingBranches.join(', ')}` : null].filter(Boolean).join(' ') || undefined;
        useActionStore.getState().setCleanupResult(item.id, message);
      }
      onClose();
    } finally { setLoading(false); }
  }
  async function prepare(run: () => Promise<ActionResult | undefined>) {
    useActionStore.getState().setCleanupResult(item.id, undefined);
    setLoading(true);
    setError(null);
    const result = await postAction<{ token: string; plans: CleanupPlan[] }>('/api/inspect-owned-cleanup', { itemId: item.id });
    setLoading(false);
    if (result.error || !result.token || !result.plans) { setError(result.error ?? 'Cannot inspect cleanup.'); return; }
    if (!result.plans.some(plan => plan.localAvailable || plan.remoteAvailable || plan.warning || plan.localBranches?.length || plan.worktreePaths?.length || plan.remoteBranch)) { await finish(run); return; }
    setLocal(false); setRemote(false); setConfirmLoss(false);
    setCleanup({ token: result.token, plans: result.plans });
    setNext(() => run);
  }
  const confirm = () => {
    if (moving) void prepare(() => resolveNeedsYou(item.id, offer));
    else if (inspection) void prepare(() => startAgain(item.id, { branchChoice: 'new' }));
    else if (offer === 'start-again') void finish(() => startAgain(item.id, {}));
    else void finish(() => resolveNeedsYou(item.id, offer));
  };
  const confirmButton = (name: string, press: () => void) =>
    <Button {...kind('main')} {...state} key={name} disabled={held} onClick={press}>{name}</Button>;

  const choices = !inspection ? [] : inspection.pr === 'open' ? ['continue'] as const : inspection.branchExists ? ['continue', 'new'] as const : ['new'] as const;
  const actions = () => {
    if (cleanup && next) return confirmButton(confirmLoss ? 'Confirm loss and proceed' : 'Proceed', () => {
      if (local && cleanup.plans.some(plan => plan.dirtyFiles.length || plan.unpushedCommits.length) && !confirmLoss) { setConfirmLoss(true); return; }
      void finish(next, { token: cleanup.token, local, remote, confirmedLoss: confirmLoss });
    });
    if (inspects && !inspection) return error ? confirmButton('Try again', () => void inspect()) : null;
    if (inspection && (inspection.branchExists || inspection.pr !== 'none')) return choices.map(branchChoice =>
      <DropdownMenu key={branchChoice}>
        <DropdownMenu.Trigger asChild><Button {...kind('main')} {...state} disabled={held}>{branchChoice === 'continue' ? 'Continue on old branch' : 'Start on new branch'}</Button></DropdownMenu.Trigger>
        <DropdownMenu.Content><StartEntries requireModel={branchChoice === 'continue' && !!inspection.worktreePath} item={item} data={data} onPick={model => { const run = () => startAgain(item.id, { branchChoice, confirmedOpenPr: inspection.pr === 'open' }, model); void (branchChoice === 'new' ? prepare(run) : finish(run)); }} /></DropdownMenu.Content>
      </DropdownMenu>);
    if (moving && item.passingBrief) return (['keep', 'reshape'] as const).map(briefChoice =>
      confirmButton(briefChoice === 'keep' ? 'Keep passing' : 'Reshape', () => void prepare(() => resolveNeedsYou(item.id, offer, briefChoice))));
    return confirmButton(loading ? 'Working…' : error ? 'Try again' : label, confirm);
  };

  return (
    <Modal onClose={dismiss}>
      {/* ninna-ui's Modal drops the description from aria-describedby, so the detail names itself. */}
      <Modal.Content id="needs-you-dialog" role="alertdialog" title={prompt.question} description="Nothing changes until you confirm."
        aria-describedby="needs-you-detail" closeOnOverlayClick={false}>
        <Modal.Body>
          <div className="grid gap-2">
            <Text id="needs-you-detail" tone="muted">{prompt.detail}</Text>
            {checking && <Text role="status">Checking the branch and PR...</Text>}
            {inspection && !cleanup && <>
              {inspection.warning && <Text role="alert">PR state is unknown. A new branch or move could create a second PR. Deleting the remote branch could close an open PR.</Text>}
              {inspection.branchExists && <Text>{inspection.worktreePath ? 'Continue in the old worktree with its uncommitted changes.' : 'The old worktree is gone. Continuing creates a new worktree on the old branch.'}</Text>}
              {inspection.pr !== 'open' && <Text>A new branch starts from the base branch and plans the build again from its brief.</Text>}
              {inspection.pr === 'open' && <Text>A new thread continues on the open PR branch. Its commits and reviews stay, and the PR stays open.</Text>}
            </>}
            {moving && item.passingBrief && !cleanup && <Text>Keep the brief passing or reshape from its text?</Text>}
            {cleanup && next && <>
              {cleanup.plans.map(plan => plan.warning && <Text role="alert" key={plan.branch}>{plan.warning} A new branch or move could create a second PR. Deleting the remote branch could close an open PR.</Text>)}
              {cleanup.plans.some(plan => plan.localAvailable) && <label><input type="checkbox" checked={local} onChange={event => { setLocal(event.target.checked); setConfirmLoss(false); }} /> Remove old local worktrees and branches</label>}
              {cleanup.plans.some(plan => plan.remoteAvailable) && <label><input type="checkbox" checked={remote} onChange={event => setRemote(event.target.checked)} /> Delete pushed remote branch</label>}
              <Text>Unticked branches and slice worktrees remain for you to remove.</Text>
              {confirmLoss && <div><Text>Deleting local work will lose these files and commits:</Text><ul>{cleanup.plans.flatMap(plan => [...plan.dirtyFiles, ...plan.unpushedCommits].map(loss => <li key={`${plan.branch}:${loss}`}>{plan.branch}: {loss}</li>))}</ul></div>}
            </>}
            {error && <Text role="alert">{error}</Text>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button {...kind('other')} disabled={loading} onClick={dismiss}>Cancel</Button>
          {actions()}
        </Modal.Footer>
      </Modal.Content>
    </Modal>
  );
}

interface CleanupPlan {
  branch: string;
  localBranches?: string[];
  worktreePaths?: string[];
  remoteBranch?: string | null;
  localAvailable: boolean;
  remoteAvailable: boolean;
  dirtyFiles: string[];
  unpushedCommits: string[];
  warning?: string;
}
