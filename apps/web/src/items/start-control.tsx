// Start on a Queued item, or Start build on a Ready one, as a menu button: Start opens a menu on
// the highlighted entry, arrow keys move, Enter or a click picks and starts, and Escape, Tab or a
// click outside closes it.
// Once a thread starts or may have started, a tag takes Start's place.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { ref, highlightedChoice, storedChoice } from '@mux-factory/shared';
import type { BoardData, Item, ModelChoice } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { Button } from '@mux-factory/ui/button';
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRadioItemIndicator, MenuTrigger } from '@mux-factory/ui/menu';
import { useItemAction } from './action-store.ts';
import { writeState } from './item-actions.tsx';
import { startItem } from './start-item.ts';
import { useStart, useStartStore } from './start-store.ts';
import type { StartKind, StartState } from './start-store.ts';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';

/**
 * The T3 thread Start opened for the item, from this page, another one or the board server's Start after. The
 * board data keeps refining threads and build threads apart, so a refined item's shaping thread is no build.
 */
function startedThread(item: Item, data: BoardData, start: StartState | undefined, kind: StartKind) {
  return (kind === 'refine' ? data.started : data.startedBuilds)?.[item.id] ?? (start?.phase === 'started' ? start.thread : undefined);
}

/** Whether Start is in flight, uncertain or done, which takes Back to List and Abandon away. */
export function useStartHolds(item: Item, data: BoardData): boolean {
  const start = useStart(item.id);
  return Boolean(startedThread(item, data, start, 'refine')) || start?.phase === 'uncertain' || start?.phase === 'pending';
}

/** "T3 default", then each provider instance's models, with the remembered choice checked. Sample mode shows them but starts nothing. */
function StartEntries({ item, data, onPick }: { item: Item; data: BoardData; onPick: (choice: ModelChoice | undefined) => void }) {
  const lastChoice = useStartStore((state) => state.lastChoice);
  const checkedEntry = useRef<HTMLDivElement>(null);
  // The menu opens on its checked entry. After Base UI has registered the entries, so arrow keys move on from it.
  useEffect(() => checkedEntry.current?.focus({ preventScroll: true }), []);
  const sample = data.capture?.enabled === false;
  const checked = storedChoice(highlightedChoice(data.modelChoices, lastChoice));
  const entry = (label: string, choice?: ModelChoice) => (
    // Pointer events stay on in sample mode, so the entry's title says why it is disabled.
    <MenuRadioItem className="data-disabled:pointer-events-auto" value={storedChoice(choice)} ref={storedChoice(choice) === checked ? checkedEntry : undefined}
      closeOnClick disabled={sample} title={sample ? 'Disabled in sample mode' : undefined}
      data-start-pick={item.id} data-instance-id={choice?.instanceId} data-model={choice?.model}
      onClick={() => !sample && onPick(choice)} key={label}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <MenuRadioItemIndicator />
      </span>
    </MenuRadioItem>
  );
  return (
    <MenuRadioGroup value={checked}>
      <MenuGroupLabel>Start with</MenuGroupLabel>
      {entry('T3 default')}
      {data.modelChoices.map((g) => (
        <MenuGroup key={g.instanceId}>
          <MenuGroupLabel>{g.name}</MenuGroupLabel>
          {g.models.map((m) => entry(m.label, { instanceId: g.instanceId, model: m.slug }))}
        </MenuGroup>
      ))}
    </MenuRadioGroup>
  );
}

/** Start, or the tag that took its place; the item dialog names it `label` and sizes it up, and the Queue outlines its later rows'. */
export function StartControl({ item, data, label = 'Start', size = 'xs', variant, icon, kind = 'refine' }: {
  item: Item; data: BoardData; label?: string; size?: 'xs' | 'sm'; variant?: 'default' | 'outline'; icon?: ReactNode; kind?: StartKind;
}) {
  const start = useStart(item.id, kind);
  const action = useItemAction(item.id);
  const [open, setOpen] = useState(false);
  const thread = startedThread(item, data, start, kind);
  // The toast announces a start; the tag only keeps Start from running twice.
  if (thread) return <span className="start-group"><Badge variant="success" className="started-tag" tabIndex={-1} data-start-result={item.id} title={`T3 thread ${thread.threadId}`}>Started</Badge></span>;
  if (start?.phase === 'uncertain') {
    // Once its message is closed, a tag still says why Start is gone.
    return <span className="start-group">{!start.message && <Badge variant="warning" className="started-tag unsure" tabIndex={-1} data-start-result={item.id} title="Check T3 before starting it again">May have started</Badge>}</span>;
  }
  const verb = start?.phase === 'pending' ? 'Starting…' : start?.phase === 'error' ? 'Retry start' : label;
  // Sample mode keeps Start's menu open-able, so the model choices can be seen; its entries start nothing.
  const state = data.capture?.enabled === false ? {} : start?.phase === 'pending' ? { 'aria-disabled': true as const } : writeState(data, action);
  const held = Boolean(state['aria-disabled']);
  const pick = (choice: ModelChoice | undefined) => {
    // Close first, so focus is back on Start before it relabels.
    flushSync(() => setOpen(false));
    void startItem(item.id, choice, kind);
  };
  return (
    <span className="start-group">
      <Menu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
        <MenuTrigger render={<Button size={size} variant={variant} />} data-start={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`} {...state}>
          {start?.phase !== 'pending' && icon}{verb}{start?.phase !== 'pending' && ' ▾'}
        </MenuTrigger>
        <MenuPopup align="end" aria-label={`Start ${ref(item)} with`}>
          <StartEntries item={item} data={data} onPick={pick} />
        </MenuPopup>
      </Menu>
    </span>
  );
}

/** Why Start failed, or that it may have run. Closing it keeps an unconfirmed start's tag. */
export function StartMessage({ item, kind = 'refine' }: { item: Item; kind?: StartKind }) {
  const start = useStart(item.id, kind);
  const el = useRef<HTMLParagraphElement>(null);
  if ((start?.phase !== 'error' && start?.phase !== 'uncertain') || !start.message) return null;
  const id = CSS.escape(item.id);
  const close = () => closeKeepingFocus(el.current, () => useStartStore.getState().set(item.id, start.phase === 'uncertain' ? { phase: 'uncertain' } : undefined, kind),
    [`[data-back-to-list="${id}"]`, `[data-start="${id}"]`, `[data-start-result="${id}"]`]);
  return (
    <p className="start" ref={el} {...(start.phase === 'uncertain' && { tabIndex: -1, 'data-start-result': item.id })}>
      <span className="action-error"><span role="alert">{start.message}</span> <DismissButton what={` error for ${ref(item)}`} onClick={close} /></span>
    </p>
  );
}
