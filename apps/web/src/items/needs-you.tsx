import { useState } from 'react';
// Why the work waits on the user, from its work record, in the item dialog: the reason and the choices the board
// offers for it, then Clear for after the user checked, such as T3 after an uncertain start. Set aside is Abandon.

import { itemName } from '@lar-factory/shared';
import type { BoardData, Item, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useActionStore, useItemAction } from './action-store.ts';
import { askAbandon, resolveNeedsYou, inspectRecovery, startAgain, postAction, receive } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { StartEntries } from './start-control.tsx';
import type { ActionResult, RecoveryInspection } from './card-actions.ts';
import { kind } from '../buttons/button-kinds.tsx';

const LABELS: Record<NeedsYouOffer, string> = {
  'start-again': 'Start again', 'back-to-queue': 'Back to Queue', 'back-to-list': 'Back to List',
  'reopen-pr': 'Reopen PR', 'replace-pr': 'Start a replacement build', 'set-aside': 'Set aside', 'reopen-work': 'Reopen the work',
};

export function NeedsYou({ item, data }: { item: Item; data: BoardData }) {
  const [move, setMove] = useState<'back-to-queue' | 'back-to-list' | null>(null);
  const [inspection, setInspection] = useState<RecoveryInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleanup, setCleanup] = useState<{ token: string; plans: CleanupPlan[] } | null>(null);
  const [next, setNext] = useState<(() => Promise<ActionResult | undefined>) | null>(null);
  const [local, setLocal] = useState(false);
  const [remote, setRemote] = useState(false);
  const [confirmLoss, setConfirmLoss] = useState(false);
  async function finish(run: () => Promise<ActionResult | undefined>, selection?: { token: string; local: boolean; remote: boolean; confirmedLoss: boolean }) {
    setLoading(true);
    try {
      const result = await run();
      if (!result || result.error || ('uncertain' in result && result.uncertain)) return;
      setCleanup(null);
      setNext(null);
      if (selection) {
        const cleaned = await postAction<{ errors: string[]; remainingBranches: string[] }>('/api/execute-owned-cleanup', { itemId: item.id, options: selection });
        receive(cleaned);
        const message = [cleaned.error, ...cleaned.errors ?? [], cleaned.remainingBranches?.length ? `Branches remain for you to remove: ${cleaned.remainingBranches.join(', ')}` : null].filter(Boolean).join(' ') || undefined;
        useActionStore.getState().setCleanupResult(item.id, message);
        setError(message ?? null);
      }
    } finally { setLoading(false); }
  }
  async function prepare(run: () => Promise<ActionResult | undefined>) {
    useActionStore.getState().setCleanupResult(item.id, undefined);
    setLoading(true);
    const result = await postAction<{ token: string; plans: CleanupPlan[] }>('/api/inspect-owned-cleanup', { itemId: item.id });
    setLoading(false);
    if (result.error || !result.token || !result.plans) { setError(result.error ?? 'Cannot inspect cleanup.'); return; }
    if (!result.plans.some(plan => plan.localAvailable || plan.remoteAvailable || plan.warning || plan.localBranches?.length || plan.worktreePaths?.length || plan.remoteBranch)) { await finish(run); return; }
    setLocal(false); setRemote(false); setConfirmLoss(false);
    setCleanup({ token: result.token, plans: result.plans });
    setNext(() => run);
  }
  async function moveBack(choice: 'back-to-queue' | 'back-to-list', briefChoice?: 'keep' | 'reshape') {
    await prepare(() => resolveNeedsYou(item.id, choice, briefChoice));
  }
  async function recover() {
    setError(null);
    if (item.needsYou?.deletedThreadPurpose !== 'build') {
      await startAgain(item.id, {});
      return;
    }
    setLoading(true);
    const result = await inspectRecovery(item.id);
    setLoading(false);
    if (result.error || !result.inspection) { setError(result.error ?? 'Cannot inspect recovery.'); return; }
    if (!result.inspection.branchExists && result.inspection.pr === 'none') await prepare(() => startAgain(item.id, { branchChoice: 'new' }));
    else setInspection(result.inspection);
  }
  const cleanupResult = useActionStore(state => state.cleanupResults[item.id]);
  const action = useItemAction(item.id);
  if (!item.needsYou && !error && !cleanupResult) return null;
  if (!item.needsYou) return <p role="alert">{cleanupResult ?? error}</p>;
  const state = writeState(data, action);
  return (
    <div className="grid gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5" data-needs-you-reason>
      <p className="m-0 font-medium text-(--warning-foreground)">Needs you: {item.needsYou.reason}</p>
      <span className="flex flex-wrap gap-1.5">
        {item.needsYou.offers.filter(offer => inspection?.pr !== 'open' || offer === 'start-again').map((offer) => (
          <Button {...kind('other')} key={offer} {...state} disabled={state.disabled || loading} aria-label={`${LABELS[offer]}: ${itemName(item)}`}
            {...offer === 'set-aside' ? { 'data-abandon': item.id, onClick: () => askAbandon(item.id) }
              : { 'data-needs-you': item.id, onClick: () => { if (offer === 'start-again') { void recover(); return; } if (item.needsYou?.deletedThread && item.passingBrief && (offer === 'back-to-queue' || offer === 'back-to-list')) setMove(offer); else if (item.needsYou?.deletedThread && (offer === 'back-to-queue' || offer === 'back-to-list')) void moveBack(offer); else void resolveNeedsYou(item.id, offer); } }}>{LABELS[offer]}</Button>
        ))}
        {!item.needsYou.deletedThread && <Button {...kind('other')} {...state} data-needs-you={item.id} aria-label={`Clear Needs you on ${itemName(item)}`}
          onClick={() => void resolveNeedsYou(item.id, 'clear')}>Clear</Button>}
      </span>
      {loading && <p role="status">Checking the branch and PR...</p>}
      {error && <p role="alert">{error}</p>}
      {inspection && <div className="grid gap-2">
        {inspection.warning && <p role="alert">PR state is unknown. A new branch or move could create a second PR. Deleting the remote branch could close an open PR.</p>}
        <p>{inspection.worktreePath ? 'Continue in the old worktree with its uncommitted changes.' : 'The old worktree is gone. Continuing creates a new worktree on the old branch.'}</p>
        {inspection.pr !== 'open' && <p>A new branch starts from the base branch and plans the build again from its brief.</p>}
        {inspection.pr === 'open' && <p>A new thread continues on the open PR branch. Its commits and reviews stay, and the PR stays open.</p>}
        {(inspection.pr === 'open' ? ['continue'] as const : inspection.branchExists ? ['continue', 'new'] as const : ['new'] as const).map(branchChoice =>
          <DropdownMenu key={branchChoice}>
            <DropdownMenu.Trigger asChild><Button {...kind('other')} {...state}>{branchChoice === 'continue' ? 'Continue on old branch' : 'Start on new branch'}</Button></DropdownMenu.Trigger>
            <DropdownMenu.Content><StartEntries requireModel={branchChoice === 'continue' && !!inspection.worktreePath} item={item} data={data} onPick={model => { const run = () => startAgain(item.id, { branchChoice, confirmedOpenPr: inspection.pr === 'open' }, model); void (branchChoice === 'new' ? prepare(run) : finish(run)); }} /></DropdownMenu.Content>
          </DropdownMenu>)}
        <Button {...kind('other')} {...state} onClick={() => setInspection(null)}>Cancel</Button>
      </div>}
      {cleanup && next && <div className="grid gap-2">
        {cleanup.plans.map(plan => plan.warning && <p role="alert" key={plan.branch}>{plan.warning} A new branch or move could create a second PR. Deleting the remote branch could close an open PR.</p>)}
        {cleanup.plans.some(plan => plan.localAvailable) && <label><input type="checkbox" checked={local} onChange={event => { setLocal(event.target.checked); setConfirmLoss(false); }} /> Remove old local worktrees and branches</label>}
        {cleanup.plans.some(plan => plan.remoteAvailable) && <label><input type="checkbox" checked={remote} onChange={event => setRemote(event.target.checked)} /> Delete pushed remote branch</label>}
        <p>Unticked branches and slice worktrees remain for you to remove.</p>
        {confirmLoss && <div><p>Deleting local work will lose these files and commits:</p><ul>{cleanup.plans.flatMap(plan => [...plan.dirtyFiles, ...plan.unpushedCommits].map(loss => <li key={`${plan.branch}:${loss}`}>{plan.branch}: {loss}</li>))}</ul></div>}
        <Button {...kind('other')} disabled={loading} onClick={() => {
          if (local && cleanup.plans.some(plan => plan.dirtyFiles.length || plan.unpushedCommits.length) && !confirmLoss) { setConfirmLoss(true); return; }
          void finish(next, { token: cleanup.token, local, remote, confirmedLoss: confirmLoss });
        }}>{confirmLoss ? 'Confirm loss and proceed' : 'Proceed'}</Button>
        <Button {...kind('other')} disabled={loading} onClick={() => { setCleanup(null); setNext(null); }}>Cancel</Button>
      </div>}
      {move && <div><p>Keep the brief passing or reshape from its text?</p>
        <Button {...kind('other')} {...state} onClick={() => void moveBack(move, 'keep')}>Keep passing</Button>
        <Button {...kind('other')} {...state} onClick={() => void moveBack(move, 'reshape')}>Reshape</Button>
      </div>}
    </div>
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
