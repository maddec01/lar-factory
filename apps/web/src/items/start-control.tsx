// Start on a Queued item, or Start build on a Ready one, as a menu button: Start opens a menu on
// the highlighted entry, arrow keys move, Enter or a click picks and starts, and Escape, Tab or a
// click outside closes it.
// Once a thread starts or may have started, a tag takes Start's place.

import { useId, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { SyntheticEvent } from 'react';
import { flushSync } from 'react-dom';
import { canResumeShaping, canRetryBuild, currentBuildThread, delegatedWorkRunning, itemName, ref, highlightedChoice, startProgressOf, storedChoice } from '@lar-factory/shared';
import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ICON, kind as buttonKind } from '../buttons/button-kinds.tsx';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { useBoardStore } from '../board/board-store.ts';
import { useItemAction } from './action-store.ts';
import { writeState } from './item-actions.tsx';
import { OpenThread } from './open-thread.tsx';
import { startItem } from './start-item.ts';
import { postAction, receive } from './card-actions.ts';
import { PURPOSE, useStart, useStartStore } from './start-store.ts';
import type { StartKind } from './start-store.ts';
import { notify } from '../notices/notices.tsx';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';

/**
 * The T3 thread Start opened for the item, from this page, another one or the board server's Start after. The
 * board data keeps refining threads and build threads apart, so a refined item's shaping thread is no build.
 */
function startedThread(item: Item, data: BoardData, kind: StartKind) {
  return (kind === 'refine' ? data.started : data.startedBuilds)?.[item.id];
}

/** The item's start as the row shows it: this page's press at once, then what the server says. */
function useShownStart(item: Item, data: BoardData, kind: StartKind) {
  const local = useStart(item.id, kind);
  const server = startProgressOf(data, item.id, PURPOSE[kind]);
  return {
    pending: local?.phase === 'pending' || server?.phase === 'starting',
    uncertain: server?.phase === 'may-have-started',
    error: server?.phase === 'failed' ? server.message : local?.phase === 'error' ? local.message : undefined,
  };
}

/** Whether Start is in flight, uncertain or done, which takes Move to List and Abandon away. */
export function useStartHolds(item: Item, data: BoardData): boolean {
  const { pending, uncertain } = useShownStart(item, data, 'refine');
  return Boolean(startedThread(item, data, 'refine')) || uncertain || pending;
}

/** "T3 default", then each provider instance's models, with the remembered choice checked. Sample mode shows them but starts nothing. */
export function StartEntries({ item, data, onPick, requireModel = false }: { item: Item; data: BoardData; requireModel?: boolean; onPick: (choice: ModelChoice | undefined) => void }) {
  const lastChoice = useStartStore((state) => state.lastChoice);
  const checked = storedChoice(highlightedChoice(data.modelChoices, lastChoice));
  const held = data.capture?.enabled === false ? 'Disabled in sample mode' : undefined;
  const headings = useId();
  const keepOpen = (event: SyntheticEvent | Event) => event.preventDefault();
  const entry = (label: string, choice?: ModelChoice) => (
    // A held entry stays hoverable and focusable rather than disabled, so its title says why; picking it does nothing.
    <DropdownMenu.RadioItem value={storedChoice(choice)} data-opens-here={storedChoice(choice) === checked || undefined}
      aria-disabled={held !== undefined || requireModel && !choice || undefined} title={held ?? (requireModel && !choice ? 'Choose a model to continue in the existing worktree.' : undefined)}
      data-start-pick={item.id} data-instance-id={choice?.instanceId} data-model={choice?.model}
      onSelect={(event) => (held === undefined && (!requireModel || choice) ? onPick(choice) : keepOpen(event))} key={label}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenu.RadioItem>
  );
  return (
    <>
      <DropdownMenu.RadioGroup value={checked} aria-labelledby={`${headings}-with`}>
        <DropdownMenu.Label id={`${headings}-with`}>Start with</DropdownMenu.Label>
        {entry('T3 default')}
        {data.modelChoices.map((g, i) => (
          <DropdownMenu.Group key={g.instanceId} aria-labelledby={`${headings}-${i}`}>
            <DropdownMenu.Label id={`${headings}-${i}`}>{g.name}</DropdownMenu.Label>
            {g.models.map((m) => entry(m.label, { instanceId: g.instanceId, model: m.slug }))}
          </DropdownMenu.Group>
        ))}
      </DropdownMenu.RadioGroup>
    </>
  );
}

/**
 * Spread on a Start menu's content, it opens the menu on its checked entry, not on the menu itself. ninna-ui passes Radix's onOpenAutoFocus through to the menu but leaves it out of its
 * props type, which a spread doesn't check.
 */
export const opensOnChecked = {
  onOpenAutoFocus: (event: Event): void => {
    event.preventDefault();
    (event.target as HTMLElement).querySelector<HTMLElement>('[data-opens-here]')?.focus({ preventScroll: true });
  },
};

/**
 * Start, a Start button named `label`, or the tag that took its place; `main` makes it its area's Main action, and
 * `naming` adds the item's name to the button, for an item whose row a filter hides.
 */
export function StartControl({ item, data, label = 'Start', main, kind = 'refine', naming }: {
  item: Item; data: BoardData; label?: string; main?: boolean; kind?: StartKind; naming?: boolean;
}) {
  const { pending, uncertain, error } = useShownStart(item, data, kind);
  const closed = useStart(item.id, kind)?.phase === 'closed';
  const action = useItemAction(item.id);
  const [open, setOpen] = useState(false);
  const thread = startedThread(item, data, kind);
  const threads = Array.isArray(item.threads) ? item.threads : [];
  // An unrecorded shaping thread can explain refining, but never a build that hasn't started.
  const recorded = thread ? threads.find((t) => t.id === thread.threadId) : undefined;
  const resume = kind === 'refine' && canResumeShaping(item) && (!thread || recorded);
  const observed = resume ? threads.find((t) => t.purpose === 'shape') ?? threads[0]
    : thread ? recorded : kind === 'refine' ? threads.find((t) => t.id !== data.startedBuilds?.[item.id]?.threadId) : undefined;
  const stopped = observed?.state === 'stopped';
  if (thread && observed?.state === 'done') {
    return <span className="start-group"><span className="basis-full">{delegatedWorkRunning(item) || observed.hasRunningChildren ? 'Working. Parent run finished.' : 'Run finished.'}</span><OpenThread item={item} data={data} threadId={observed.id} /></span>;
  }
  // The toast announces a start; the tag only keeps Start from running twice.
  if (thread && !stopped && !pending) return <span className="start-group"><Badge tone="success" className="started-tag" tabIndex={-1} data-start-result={item.id} title={`T3 thread ${thread.threadId}`}>Started</Badge></span>;
  if (uncertain) {
    // Once its message is closed, a tag still says why Start is gone.
    return <span className="start-group">{closed && <Badge tone="warning" className="started-tag unsure" tabIndex={-1} data-start-result={item.id} title="Check T3 before starting it again">May have started</Badge>}</span>;
  }
  const retry = kind === 'build' && canRetryBuild(item);
  const verb = pending ? 'Starting…' : error || retry ? 'Retry start' : stopped && !resume ? 'Start again' : label;
  // Sample mode keeps Start's menu open-able, so the model choices can be seen; its entries start nothing.
  const state = data.capture?.enabled === false ? {} : pending ? { 'aria-disabled': true as const } : writeState(data, action);
  const held = Boolean(state['aria-disabled']);
  const pick = (choice: ModelChoice | undefined) => {
    // Close first, so focus is back on Start before it relabels.
    flushSync(() => setOpen(false));
    void startItem(item.id, choice, kind);
  };
  return (
    <span className="start-group">
      {retry ? <OpenThread item={item} data={data} iconOnly threadId={currentBuildThread(item)?.id} />
        : stopped && <><span className="basis-full">Run stopped.</span><OpenThread item={item} data={data} threadId={observed.id} /></>}
      <DropdownMenu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button {...buttonKind(main ? 'main' : 'start')} aria-busy={pending || undefined} leftIcon={pending ? <LoaderCircle className="animate-spin" /> : !main && !retry && ICON.play} data-start={item.id} aria-label={`${verb} ${itemName(item)}`} {...state}
            {...naming && { className: 'max-w-96', title: `A filter hides ${itemName(item)}` }}>
            {naming ? <span className="truncate">{verb}: {itemName(item)}</span> : verb}{!pending && ' ▾'}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" aria-label={`Start ${ref(item)} with`} {...opensOnChecked}>
          <StartEntries item={item} data={data} onPick={pick} />
        </DropdownMenu.Content>
      </DropdownMenu>
    </span>
  );
}

/** Clears a failed start on every page, or a failure only this page holds. */
async function dismissFailure(item: Item, kind: StartKind): Promise<void> {
  useStartStore.getState().set(item.id, undefined, kind);
  const session = useBoardStore.getState().data.capture?.session;
  const result = await postAction('/api/dismiss-start-error', { session, itemId: item.id, purpose: PURPOSE[kind] });
  flushSync(() => {
    receive(result);
    if (result.error) notify({ verb: 'Failed', item, startError: true, message: result.error });
  });
}

/** Why Start failed, or that it may have run. Closing it keeps an unconfirmed start's tag. */
export function StartMessage({ item, kind = 'refine' }: { item: Item; kind?: StartKind }) {
  const data = useBoardStore((state) => state.data);
  const local = useStart(item.id, kind);
  const server = startProgressOf(data, item.id, PURPOSE[kind]);
  const el = useRef<HTMLParagraphElement>(null);
  const uncertain = server?.phase === 'may-have-started';
  const message = server?.phase === 'failed' || uncertain ? local?.phase === 'closed' && uncertain ? undefined : server.message : local?.phase === 'error' ? local.message : undefined;
  if (!message) return null;
  const id = CSS.escape(item.id);
  const close = () => closeKeepingFocus(el.current, () => {
    if (uncertain) useStartStore.getState().set(item.id, { phase: 'closed' }, kind);
    else void dismissFailure(item, kind);
  }, [`[data-back-to-list="${id}"]`, `[data-start="${id}"]`, `[data-start-result="${id}"]`]);
  return (
    <p className="start" ref={el} {...(uncertain && { tabIndex: -1, 'data-start-result': item.id })}>
      <span className="action-error"><span role="alert">{message}</span> <DismissButton what={` error for ${ref(item)}`} onClick={close} /></span>
    </p>
  );
}
