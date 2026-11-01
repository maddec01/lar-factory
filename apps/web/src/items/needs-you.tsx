import { useState } from 'react';
// Why the work waits on the user, from its work record, in the item dialog: the reason and the choices the board
// offers for it, then Clear for after the user checked, such as T3 after an uncertain start. Set aside is Abandon.

import { itemName } from '@lar-factory/shared';
import type { BoardData, Item, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useItemAction } from './action-store.ts';
import { askAbandon, resolveNeedsYou, inspectRecovery, startAgain } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { StartEntries } from './start-control.tsx';
import type { RecoveryInspection } from './card-actions.ts';
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
    if (!result.inspection.branchExists && result.inspection.pr === 'none') await startAgain(item.id, { branchChoice: 'new' });
    else setInspection(result.inspection);
  }
  const action = useItemAction(item.id);
  if (!item.needsYou) return null;
  const state = writeState(data, action);
  return (
    <div className="grid gap-2 rounded-xl border border-[color-mix(in_srgb,var(--warning)_35%,transparent)] bg-(--warning-surface) px-3 py-2.5" data-needs-you-reason>
      <p className="m-0 font-medium text-(--warning-foreground)">Needs you: {item.needsYou.reason}</p>
      <span className="flex flex-wrap gap-1.5">
        {item.needsYou.offers.filter(offer => inspection?.pr !== 'open' || offer === 'start-again').map((offer) => (
          <Button {...kind('other')} key={offer} {...state} disabled={state.disabled || loading} aria-label={`${LABELS[offer]}: ${itemName(item)}`}
            {...offer === 'set-aside' ? { 'data-abandon': item.id, onClick: () => askAbandon(item.id) }
              : { 'data-needs-you': item.id, onClick: () => { if (offer === 'start-again') { void recover(); return; } if (item.needsYou?.deletedThread && item.passingBrief && (offer === 'back-to-queue' || offer === 'back-to-list')) setMove(offer); else void resolveNeedsYou(item.id, offer); } }}>{LABELS[offer]}</Button>
        ))}
        {!item.needsYou.deletedThread && <Button {...kind('other')} {...state} data-needs-you={item.id} aria-label={`Clear Needs you on ${itemName(item)}`}
          onClick={() => void resolveNeedsYou(item.id, 'clear')}>Clear</Button>}
      </span>
      {loading && <p role="status">Checking the branch and PR...</p>}
      {error && <p role="alert">{error}</p>}
      {inspection && <div className="grid gap-2">
        {inspection.warning && <p role="alert">PR state is unknown. A new branch or move could create a second PR.</p>}
        <p>{inspection.worktreePath ? 'Continue in the old worktree with its uncommitted changes.' : 'The old worktree is gone. Continuing creates a new worktree on the old branch.'}</p>
        {inspection.pr !== 'open' && <p>A new branch starts from the base branch and plans the build again from its brief.</p>}
        {inspection.pr === 'open' && <p>A new thread continues on the open PR branch. Its commits and reviews stay, and the PR stays open.</p>}
        {(inspection.pr === 'open' ? ['continue'] as const : inspection.branchExists ? ['continue', 'new'] as const : ['new'] as const).map(branchChoice =>
          <DropdownMenu key={branchChoice}>
            <DropdownMenu.Trigger asChild><Button {...kind('other')} {...state}>{branchChoice === 'continue' ? 'Continue on old branch' : 'Start on new branch'}</Button></DropdownMenu.Trigger>
            <DropdownMenu.Content><StartEntries requireModel={branchChoice === 'continue' && !!inspection.worktreePath} item={item} data={data} onPick={model => void startAgain(item.id, { branchChoice, confirmedOpenPr: inspection.pr === 'open' }, model)} /></DropdownMenu.Content>
          </DropdownMenu>)}
        <Button {...kind('other')} {...state} onClick={() => setInspection(null)}>Cancel</Button>
      </div>}
      {move && <div><p>Keep the brief passing or reshape from its text?</p>
        <Button {...kind('other')} {...state} onClick={() => void resolveNeedsYou(item.id, move, 'keep')}>Keep passing</Button>
        <Button {...kind('other')} {...state} onClick={() => void resolveNeedsYou(item.id, move, 'reshape')}>Reshape</Button>
      </div>}
    </div>
  );
}
