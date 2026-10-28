// Start after, beside a blocked part's disabled Start: its menu arms the start on a model choice, so the board server
// starts the part once every issue it's blocked by closes. It reads "Starts after #n ✓" until then, and pressing it
// again disarms it. A start the server ran by itself and that failed leaves its error on the part. StartOrAfter is
// the item's Start wherever a start can be blocked: the disabled Start with Start after beside it while it's blocked.

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Play } from 'lucide-react';
import { prototype525 } from '../title-bar/prototype-525-state.ts';
import { blockedText, carriesTwoStatuses, openBlockerRefs, openBlockers, ref, startHold, startRequest } from '@lar-factory/shared';
import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { useBoardStore } from '../board/board-store.ts';
import { notify } from '../notices/notices.tsx';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';
import { postAction, receive } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { StartControl, StartEntries, opensOnChecked } from './start-control.tsx';
import type { StartKind } from './start-store.ts';

/** The open blocker Start after names, the last one when several are open, as `#n` or `owner/repo#n`; null once none is. */
const startsAfter = (item: Item, short = false): string | null => openBlockerRefs(item, short).at(-1) ?? null;

/** Lets a Start after button shrink inside its row, its label truncating while its mark stays. */
const SHRINKS = 'min-w-0 max-w-full shrink';

/** What the title says Start after waits for: every open blocker. */
function waitsFor(item: Item): string {
  const open = openBlockerRefs(item);
  return `${open.join(', ')} ${open.length > 1 ? 'close' : 'closes'}`;
}

/** Arms the item's start on `choice`, or disarms it with `null`; a refusal shows as a toast. */
async function setArmed(item: Item, choice: ModelChoice | undefined | null, repo?: string): Promise<void> {
  const session = useBoardStore.getState().data.capture?.session;
  const result = choice === null ? await postAction('/api/disarm', { session, itemId: item.id })
    : await postAction('/api/arm', startRequest(session, item.id, choice, repo));
  flushSync(() => {
    receive(result);
    if (result.error) notify({ verb: 'Failed', item, message: result.error });
  });
}

/** Start after #n, or Starts after #n ✓ while armed, outlined beside the Start it follows. */
function StartAfter({ item, data }: { item: Item; data: BoardData }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const after = startsAfter(item);
  const label = startsAfter(item, true);
  if (!after) return null;
  const armed = !!data.armed?.[item.id];
  const writes = pending ? { 'aria-disabled': true as const } : writeState(data);
  const held = Boolean(writes['aria-disabled']);
  const run = async (choice: ModelChoice | undefined | null, repo?: string) => {
    setPending(true);
    try { await setArmed(item, choice, repo); } finally { setPending(false); }
  };
  if (armed) {
    return (
      <Button variant="secondary" className={SHRINKS} data-start-after={item.id} aria-pressed aria-label={`Starts after ${after}`}
        title={`Starts by itself once ${waitsFor(item)}. Pressing it again disarms it`} {...writes}
        onClick={() => !held && void run(null)}><span className="truncate">Starts after {label}</span> ✓</Button>
    );
  }
  const pick = (choice: ModelChoice | undefined, repo?: string) => {
    flushSync(() => setOpen(false));
    void run(choice, repo);
  };
  // Sample mode keeps the menu open-able, so the model choices can be seen; its entries arm nothing.
  return (
    <DropdownMenu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" leftIcon={prototype525 && <Play />} className={SHRINKS} data-start-after={item.id} aria-label={`Start ${ref(item)} ${item.title} after ${after}`}
          title={`Starts by itself once ${waitsFor(item)}`} {...(data.capture?.enabled === false ? {} : writes)}><span className="truncate">Start after {label}</span> ▾</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end" aria-label={`Start ${ref(item)} after ${after} with`} {...opensOnChecked}>
        <StartEntries item={item} data={data} onPick={pick} />
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}

/**
 * The item's Start, the StartControl named `label`, while nothing holds it. An open blocker holds it, and so does its
 * repository, where a refining thread and a build both start, while it is still onboarding or T3 has no project for
 * it. A held start is disabled, its title saying why: the repository's hold, else the open issues it's blocked by;
 * `quiet` outlines it, as the line draws a held action. While only a blocker holds it, Start after sits beside it, or
 * stands alone with `afterOnly`, as a dossier's map shows it. While the repository holds it an armed start would
 * fail, so none is offered; one armed before the hold still shows, so it can be disarmed. An item carrying more than
 * one status gets no Start until the user keeps one.
 */
export function StartOrAfter({ item, data, label = 'Start', variant, icon, kind = 'refine', quiet, afterOnly }: {
  item: Item; data: BoardData; label?: string; variant?: 'primary' | 'secondary'; icon?: ReactNode; kind?: StartKind;
  quiet?: boolean; afterOnly?: boolean;
}) {
  if (carriesTwoStatuses(item)) return null;
  const hold = startHold(data, item.repo);
  const blocked = openBlockers(item).length > 0;
  if (!blocked && !hold) return <StartControl item={item} data={data} label={label} variant={variant} icon={icon} kind={kind} />;
  // Pointer events stay on while it's disabled, so its title says why.
  const start = (
    <Button variant={variant ?? (quiet ? 'secondary' : 'primary')} leftIcon={icon ?? (prototype525 && <Play />)} className="disabled:pointer-events-auto" data-start={item.id} disabled
      title={hold ?? blockedText(item) ?? undefined}>
      {label}
    </Button>
  );
  if ((hold && !data.armed?.[item.id]) || !blocked) return start;
  // THROWAWAY #525: a blocked item shows only Start after, everywhere.
  if (afterOnly || prototype525) return <StartAfter item={item} data={data} />;
  // With no room for both, Start after wraps under Start, then truncates.
  return <span className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">{start}<StartAfter item={item} data={data} /></span>;
}

/** Why the start the board ran by itself failed; dismissing it clears it on the server. */
export function StartAfterError({ item, data }: { item: Item; data: BoardData }) {
  const el = useRef<HTMLParagraphElement>(null);
  const error = data.armedErrors?.[item.id];
  if (!error) return null;
  const id = CSS.escape(item.id);
  const close = () => closeKeepingFocus(el.current, () => void setArmed(item, null), [`[data-start-after="${id}"]`, `[data-start="${id}"]`]);
  return (
    <p className="start" ref={el} data-start-after-error={item.id}>
      <span className="action-error"><span role="alert">Start after failed: {error}</span> <DismissButton what={` Start after error for ${ref(item)}`} onClick={close} /></span>
    </p>
  );
}
