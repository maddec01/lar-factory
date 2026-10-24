// Start after, beside a blocked part's disabled Start: its menu arms the start on a model choice, so the board server
// starts the part once every issue it's blocked by closes. It reads "Starts after #n ✓" until then, and pressing it
// again disarms it. A start the server ran by itself and that failed leaves its error on the part. StartOrAfter is
// the item's Start wherever a start can be blocked: the disabled Start with Start after beside it while it's blocked.

import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { blockedText, openBlockerRefs, openBlockers, ref, repositoryProjectHint, startRequest } from '@mux-factory/shared';
import type { BoardData, Item, ModelChoice } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { Menu, MenuPopup, MenuTrigger } from '@mux-factory/ui/menu';
import { useBoardStore } from '../board/board-store.ts';
import { notify } from '../notices/notices.tsx';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';
import { postAction, receive } from './card-actions.ts';
import { writeState } from './item-actions.tsx';
import { StartControl, StartEntries } from './start-control.tsx';
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
async function setArmed(item: Item, choice: ModelChoice | undefined | null): Promise<void> {
  const session = useBoardStore.getState().data.capture?.session;
  const result = choice === null ? await postAction('/api/disarm', { session, itemId: item.id })
    : await postAction('/api/arm', startRequest(session, item.id, choice));
  flushSync(() => {
    receive(result);
    if (result.error) notify({ verb: 'Failed', item, message: result.error });
  });
}

/** Start after #n, or Starts after #n ✓ while armed. `size` and `variant` follow the Start it sits beside. */
function StartAfter({ item, data, size = 'xs', variant = 'outline' }: { item: Item; data: BoardData; size?: 'xs' | 'sm'; variant?: 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const after = startsAfter(item);
  const label = startsAfter(item, true);
  if (!after) return null;
  const armed = !!data.armed?.[item.id];
  const writes = pending ? { 'aria-disabled': true as const } : writeState(data);
  const held = Boolean(writes['aria-disabled']);
  const run = async (choice: ModelChoice | undefined | null) => {
    setPending(true);
    try { await setArmed(item, choice); } finally { setPending(false); }
  };
  if (armed) {
    return (
      <Button size={size} variant={variant} className={SHRINKS} data-start-after={item.id} aria-pressed aria-label={`Starts after ${after}`}
        title={`Starts by itself once ${waitsFor(item)}. Pressing it again disarms it`} {...writes}
        onClick={() => !held && void run(null)}><span className="truncate">Starts after {label}</span> ✓</Button>
    );
  }
  const pick = (choice: ModelChoice | undefined) => {
    flushSync(() => setOpen(false));
    void run(choice);
  };
  // Sample mode keeps the menu open-able, so the model choices can be seen; its entries arm nothing.
  return (
    <Menu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
      <MenuTrigger render={<Button size={size} variant={variant} className={SHRINKS} />} data-start-after={item.id} aria-label={`Start ${ref(item)} ${item.title} after ${after}`}
        title={`Starts by itself once ${waitsFor(item)}`} {...(data.capture?.enabled === false ? {} : writes)}><span className="truncate">Start after {label}</span> ▾</MenuTrigger>
      <MenuPopup align="end" aria-label={`Start ${ref(item)} after ${after} with`}>
        <StartEntries item={item} data={data} onPick={pick} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The item's Start, the StartControl named `label`, while nothing holds it. An open blocker holds it, and so does a
 * missing T3 project for its repository, where a refining thread and a build both start. A held start is disabled,
 * its title saying why: the hint for adding the project, else the open issues it's blocked by; `quiet` outlines it,
 * as the line draws a held action. While only a blocker holds it, Start after sits beside it, or stands alone with
 * `afterOnly`, as a dossier's map shows it. Without the project an armed start would fail, so none is offered; one
 * armed before the project went still shows, so it can be disarmed.
 */
export function StartOrAfter({ item, data, label = 'Start', size = 'xs', variant, icon, kind = 'refine', quiet, afterOnly }: {
  item: Item; data: BoardData; label?: string; size?: 'xs' | 'sm'; variant?: 'default' | 'outline'; icon?: ReactNode; kind?: StartKind;
  quiet?: boolean; afterOnly?: boolean;
}) {
  const hint = repositoryProjectHint(data, item.repo);
  const blocked = openBlockers(item).length > 0;
  if (!blocked && !hint) return <StartControl item={item} data={data} label={label} size={size} variant={variant} icon={icon} kind={kind} />;
  // Pointer events stay on while it's disabled, so its title says why.
  const start = (
    <Button size={size} variant={variant ?? (quiet ? 'outline' : undefined)} className="disabled:pointer-events-auto" data-start={item.id} disabled
      title={hint ?? blockedText(item) ?? undefined}>
      {icon}{label}
    </Button>
  );
  if ((hint && !data.armed?.[item.id]) || !blocked) return start;
  if (afterOnly) return <StartAfter item={item} data={data} size={size} />;
  // With no room for both, Start after wraps under Start, then truncates.
  return <span className="inline-flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1">{start}<StartAfter item={item} data={data} size={size} /></span>;
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
