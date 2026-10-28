// Start on a Queued item, or Start build on a Ready one, as a menu button: Start opens a menu on
// the highlighted entry, arrow keys move, Enter or a click picks and starts, and Escape, Tab or a
// click outside closes it. On an untagged Azure work item that several repositories read, with the Scope on All,
// the menu first asks which repository it's for.
// Once a thread starts or may have started, a tag takes Start's place.

import { useId, useRef, useState } from 'react';
import type { SyntheticEvent } from 'react';
import { flushSync } from 'react-dom';
import { ref, highlightedChoice, repoName, startRepo, storedChoice } from '@lar-factory/shared';
import type { BoardData, Item, ModelChoice } from '@lar-factory/shared';
import { Badge } from '@lar-factory/ui/design-system/Badge';
import { Button } from '@lar-factory/ui/design-system/Button';
import { ICON, kind as buttonKind } from '../buttons/button-kinds.tsx';
import { DropdownMenu } from '@lar-factory/ui/design-system/DropdownMenu';
import { useItemAction } from './action-store.ts';
import { writeState } from './item-actions.tsx';
import { OpenThread } from './open-thread.tsx';
import { startItem } from './start-item.ts';
import { useStart, useStartStore } from './start-store.ts';
import type { StartKind, StartState } from './start-store.ts';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';
import { useScopeStore } from '../board/scope-store.ts';

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

/**
 * "T3 default", then each provider instance's models, with the remembered choice checked. Sample mode shows them but
 * starts nothing. An untagged Azure work item goes to the repository the Scope picks, or its only one; else the menu
 * lists the repositories reading it first, and a model starts only once one is picked. `onPick` gets the repository for
 * an untagged item.
 */
export function StartEntries({ item, data, onPick }: { item: Item; data: BoardData; onPick: (choice: ModelChoice | undefined, repo?: string) => void }) {
  const lastChoice = useStartStore((state) => state.lastChoice);
  const scope = useScopeStore((state) => state.scope);
  const [picked, setPicked] = useState<string>();
  const sample = data.capture?.enabled === false;
  const scoped = startRepo(item, scope ?? undefined);
  const asks = Boolean(item.untaggedFor) && scoped === undefined;
  const repo = item.untaggedFor ? scoped ?? picked : undefined;
  const unpicked = asks && picked === undefined;
  const checked = storedChoice(highlightedChoice(data.modelChoices, lastChoice));
  const held = sample ? 'Disabled in sample mode' : unpicked ? 'Pick a repository first' : undefined;
  // Until a repository is picked, a line under the repositories says so, and each model entry points at it.
  const pickHint = useId();
  const headings = useId();
  const keepOpen = (event: SyntheticEvent | Event) => event.preventDefault();
  const entry = (label: string, choice?: ModelChoice) => (
    // A held entry stays hoverable and focusable rather than disabled, so its title says why; picking it does nothing.
    <DropdownMenu.RadioItem value={storedChoice(choice)} data-opens-here={(!asks && storedChoice(choice) === checked) || undefined}
      aria-disabled={held !== undefined || undefined} title={held} aria-describedby={unpicked ? pickHint : undefined}
      data-start-pick={item.id} data-instance-id={choice?.instanceId} data-model={choice?.model}
      onSelect={(event) => (held === undefined ? onPick(choice, repo) : keepOpen(event))} key={label}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </DropdownMenu.RadioItem>
  );
  return (
    <>
      {asks && (
        <DropdownMenu.RadioGroup value={picked ?? ''} onValueChange={(value: string) => setPicked(value)} aria-labelledby={`${headings}-repo`}>
          <DropdownMenu.Label id={`${headings}-repo`}>For repository</DropdownMenu.Label>
          {item.untaggedFor!.map((r, i) => (
            <DropdownMenu.RadioItem value={r} key={r} data-opens-here={i === 0 || undefined} onSelect={keepOpen} data-start-repo={r}>
              <span className="min-w-0 flex-1 truncate">{repoName(r, data.repos)}</span>
            </DropdownMenu.RadioItem>
          ))}
          {unpicked && <p id={pickHint} className="px-2 py-1 text-base-700 text-xs" data-start-pick-hint>Pick a repository first.</p>}
        </DropdownMenu.RadioGroup>
      )}
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
 * Spread on a Start menu's content, it opens the menu on its checked entry, or on the first repository while it asks
 * for one, not on the menu itself. ninna-ui passes Radix's onOpenAutoFocus through to the menu but leaves it out of its
 * props type, which a spread doesn't check.
 */
export const opensOnChecked = {
  onOpenAutoFocus: (event: Event): void => {
    event.preventDefault();
    (event.target as HTMLElement).querySelector<HTMLElement>('[data-opens-here]')?.focus({ preventScroll: true });
  },
};

/** Start, a Start button named `label`, or the tag that took its place; `main` makes it its area's Main action. */
export function StartControl({ item, data, label = 'Start', main, kind = 'refine' }: {
  item: Item; data: BoardData; label?: string; main?: boolean; kind?: StartKind;
}) {
  const start = useStart(item.id, kind);
  const action = useItemAction(item.id);
  const [open, setOpen] = useState(false);
  const thread = startedThread(item, data, start, kind);
  const observed = Array.isArray(item.threads) ? (thread ? item.threads.find((t) => t.id === thread.threadId) : item.threads[0]) : undefined;
  if (observed?.state === 'stopped' || (thread && observed?.state === 'done')) {
    return <span className="start-group"><span>{observed.state === 'stopped' ? 'Run stopped.' : 'Run finished.'}</span><OpenThread item={item} data={data} /></span>;
  }
  // The toast announces a start; the tag only keeps Start from running twice.
  if (thread) return <span className="start-group"><Badge tone="success" className="started-tag" tabIndex={-1} data-start-result={item.id} title={`T3 thread ${thread.threadId}`}>Started</Badge></span>;
  if (start?.phase === 'uncertain') {
    // Once its message is closed, a tag still says why Start is gone.
    return <span className="start-group">{!start.message && <Badge tone="warning" className="started-tag unsure" tabIndex={-1} data-start-result={item.id} title="Check T3 before starting it again">May have started</Badge>}</span>;
  }
  const verb = start?.phase === 'pending' ? 'Starting…' : start?.phase === 'error' ? 'Retry start' : label;
  // Sample mode keeps Start's menu open-able, so the model choices can be seen; its entries start nothing.
  const state = data.capture?.enabled === false ? {} : start?.phase === 'pending' ? { 'aria-disabled': true as const } : writeState(data, action);
  const held = Boolean(state['aria-disabled']);
  const pick = (choice: ModelChoice | undefined, repo?: string) => {
    // Close first, so focus is back on Start before it relabels.
    flushSync(() => setOpen(false));
    void startItem(item.id, choice, kind, repo);
  };
  return (
    <span className="start-group">
      <DropdownMenu open={open && !held} onOpenChange={(next) => setOpen(next && !held)} modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button {...buttonKind(main ? 'main' : 'start')} leftIcon={start?.phase !== 'pending' && !main && ICON.play} data-start={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`} {...state}>
            {verb}{start?.phase !== 'pending' && ' ▾'}
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" aria-label={`Start ${ref(item)} with`} {...opensOnChecked}>
          <StartEntries item={item} data={data} onPick={pick} />
        </DropdownMenu.Content>
      </DropdownMenu>
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
