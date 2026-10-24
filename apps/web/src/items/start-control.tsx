// Start on a Queued card, as a menu button: Start opens a menu on the highlighted entry, arrow
// keys move, Enter or a click picks and starts, and Escape, Tab or a click outside closes it.
// Once a thread starts or may have started, a tag takes Start's place.

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Menu } from '@base-ui/react/menu';
import { ref, highlightedChoice, storedChoice } from '@mux-factory/shared';
import type { BoardData, Item, ModelChoice } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { useItemAction } from './action-store.ts';
import { writeState } from './card.tsx';
import { startItem } from './start-item.ts';
import { useStart, useStartStore } from './start-store.ts';
import type { StartState } from './start-store.ts';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';

/** The T3 thread Start opened for the item, from this page or another. */
function startedThread(item: Item, data: BoardData, start: StartState | undefined) {
  return data.started?.[item.id] ?? (start?.phase === 'started' ? start.thread : undefined);
}

/** Whether Start is in flight, uncertain or done, which takes Back to List and Abandon away. */
export function useStartHolds(item: Item, data: BoardData): boolean {
  const start = useStart(item.id);
  return Boolean(startedThread(item, data, start)) || start?.phase === 'uncertain' || start?.phase === 'pending';
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
    <Menu.RadioItem className="start-pick" value={storedChoice(choice)} ref={storedChoice(choice) === checked ? checkedEntry : undefined}
      closeOnClick disabled={sample} title={sample ? 'Disabled in sample mode' : undefined}
      data-start-pick={item.id} data-instance-id={choice?.instanceId} data-model={choice?.model}
      onClick={() => !sample && onPick(choice)} key={label}>{label}</Menu.RadioItem>
  );
  return (
    <Menu.RadioGroup value={checked}>
      <p className="start-menu-head" aria-hidden="true">Start with</p>
      {entry('T3 default')}
      {data.modelChoices.map((g) => (
        <Menu.Group key={g.instanceId}>
          <Menu.GroupLabel className="start-menu-group">{g.name}</Menu.GroupLabel>
          {g.models.map((m) => entry(m.label, { instanceId: g.instanceId, model: m.slug }))}
        </Menu.Group>
      ))}
    </Menu.RadioGroup>
  );
}

/** Start in the card's top-right corner, or the tag that took its place. */
export function StartControl({ item, data }: { item: Item; data: BoardData }) {
  const start = useStart(item.id);
  const action = useItemAction(item.id);
  const [open, setOpen] = useState(false);
  const thread = startedThread(item, data, start);
  // The toast announces a start; the card only keeps Start from running twice.
  if (thread) return <span className="start-group"><span className="started-tag" tabIndex={-1} data-start-result={item.id} title={`T3 thread ${thread.threadId}`}>Started</span></span>;
  if (start?.phase === 'uncertain') {
    // Once its message is closed, a tag still says why Start is gone.
    return <span className="start-group">{!start.message && <span className="started-tag unsure" tabIndex={-1} data-start-result={item.id} title="Check T3 before starting it again">May have started</span>}</span>;
  }
  const verb = start?.phase === 'pending' ? 'Starting…' : start?.phase === 'error' ? 'Retry start' : 'Start';
  // Sample mode keeps Start's menu open-able, so the model choices can be seen; its entries start nothing.
  const state = data.capture?.enabled === false ? {} : start?.phase === 'pending' ? { 'aria-disabled': true as const } : writeState(data, action);
  const held = Boolean(state['aria-disabled']);
  const pick = (choice: ModelChoice | undefined) => {
    // Close first, so focus is back on Start before it relabels.
    flushSync(() => setOpen(false));
    void startItem(item.id, choice);
  };
  return (
    <span className="start-group">
      <Menu.Root open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
        <Menu.Trigger render={<Button size="xs" />} data-start={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`} {...state}>
          {verb}{start?.phase !== 'pending' && ' ▾'}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="start-menu-positioner" side="bottom" align="end" sideOffset={4}>
            <Menu.Popup className="start-menu" aria-label={`Start ${ref(item)} with`}>
              <StartEntries item={item} data={data} onPick={pick} />
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </span>
  );
}

/** Under the card: why Start failed, or that it may have run. Closing it keeps an unconfirmed start's tag. */
export function StartMessage({ item }: { item: Item }) {
  const start = useStart(item.id);
  const el = useRef<HTMLParagraphElement>(null);
  if ((start?.phase !== 'error' && start?.phase !== 'uncertain') || !start.message) return null;
  const id = CSS.escape(item.id);
  const close = () => closeKeepingFocus(el.current, () => useStartStore.getState().set(item.id, start.phase === 'uncertain' ? { phase: 'uncertain' } : undefined),
    [`[data-back-to-list="${id}"]`, `[data-start="${id}"]`, `[data-start-result="${id}"]`]);
  return (
    <p className="start" ref={el} {...(start.phase === 'uncertain' && { tabIndex: -1, 'data-start-result': item.id })}>
      <span className="action-error"><span role="alert">{start.message}</span> <DismissButton what={` error for ${ref(item)}`} onClick={close} /></span>
    </p>
  );
}
