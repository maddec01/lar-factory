// The title bar's update pill, a Port of T3 Code's update pill (apps/web/src/components/sidebar/SidebarUpdatePill.tsx
// at d53873b) on the copied Popover, Button and Tooltip, drawn as the board's other App controls are, tinted in
// every state (buttons/button-kinds.tsx), instead of as T3's pill. With no update it
// doesn't show; Settings › Updates checks. An available update reads "Update available", a download shows a progress
// ring with the percentage, and a downloaded update reads "Restart to update". Clicking the pill runs that step, with
// T3's toasts from the store; installing asks first in the app's native dialog, as T3 does. While the app installs,
// the pill reads "Installing…", disabled.
// Hovering the pill, or focusing it from the keyboard, opens T3's changelog (as SidebarUpdateReleaseNotes) below it,
// with the update's version, each Release's changes and the step's button. It closes 150 ms after the pointer leaves
// both, as T3's does, and on Escape. Focus stays on the pill, which runs the same step.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { boardApp, type UpdateState } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { Popover } from '@lar-factory/ui/design-system/Popover';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-factory/ui/design-system/Tooltip';
import { useUpdateStore } from './update-store.ts';
import { downloadPercent, resolveUpdateButtonAction, resolveUpdatePill, updateStatusText } from './update-button-logic.ts';
import { kind } from '../buttons/button-kinds.tsx';
import { UpdateStatusIcon } from './UpdateStatusIcon.tsx';

/** The pill's shape: an App control, with its corners and 28 px height, tinted in every state. */
const PILL = 'update-button gap-1.5 font-medium';
const CLOSE_DELAY_MS = 150;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Each Release's changes, newest Release first, with what the app left out. */
function ReleaseNotes({ state }: { state: UpdateState }) {
  return (
    <>
      {state.releaseNotes.map((note, index) => {
        const omitted = note.totalItems - note.items.length;
        return (
          <section className="not-first:mt-3 not-first:border-t not-first:border-base-300 not-first:pt-3" key={note.version}>
            <h3 className="m-0 text-xs font-semibold leading-4 text-base-content">{index === 0 ? 'What\'s changed' : `Changes in ${note.version}`}</h3>
            <ul className="m-0 mt-2 space-y-1.5 pl-4 text-xs leading-5 text-base-700">
              {note.items.map((item, i) => <li className="list-disc break-words" key={i}>{item}</li>)}
            </ul>
            {omitted > 0 && <p className="m-0 mt-2 text-xs leading-5 text-base-700">{plural(omitted, 'more change')} in this Release</p>}
          </section>
        );
      })}
      {state.omittedReleaseCount > 0 && (
        <p className="m-0 mt-3 border-t border-base-300 pt-3 text-xs leading-5 text-base-700">{plural(state.omittedReleaseCount, 'older Release')} not shown</p>
      )}
    </>
  );
}

/** Open while the pointer is on the pill or the changelog, and for 150 ms after it leaves both. */
function useHoverOpen() {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };
  const hover = {
    // A touch has no hover: a tap runs the step.
    onPointerEnter: (event: PointerEvent) => event.pointerType !== 'touch' && show(),
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
    },
  };
  return { open, show, close, hover };
}

/** The pill while the update downloads: nothing to click, a progress bar to screen readers, with the version in its
 *  tooltip. */
function Downloading({ state }: { state: UpdateState }) {
  const percent = downloadPercent(state);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role="progressbar" aria-label={`Downloading ${state.availableVersion ?? 'the update'}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
          data-kind="control" data-tint
          className={`${PILL} inline-flex items-center rounded-md px-[11px] outline-none focus-visible:ring-2 focus-visible:ring-primary`}>
          <UpdateStatusIcon status="downloading" downloadPercent={percent} />
          Downloading <span className="w-7 tabular-nums">{percent}%</span>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{updateStatusText(state)}</TooltipPopup>
    </Tooltip>
  );
}

/** "Update available" or "Restart to update", with the changelog and the step's button. */
function NextStep({ state, ready }: { state: UpdateState; ready: boolean }) {
  const { installing, pending, run } = useUpdateStore();
  const { open, show, close, hover } = useHoverOpen();
  const disabled = installing || pending || resolveUpdateButtonAction(state) === 'none';
  return (
    <Popover open={open} onOpenChange={(next) => !next && close()}>
      <Popover.Trigger asChild>
        <Button
          {...kind('control')} data-tint
          aria-disabled={disabled || undefined}
          className={`${PILL} ${disabled ? 'cursor-not-allowed' : ''}`}
          // The pill runs the step; the changelog opens on hover and focus, not on the click.
          onClick={(event) => {
            event.preventDefault();
            if (!disabled) void run();
          }}
          onFocus={(event) => event.currentTarget.matches(':focus-visible') && show()}
          {...hover}
        >
          <UpdateStatusIcon status={ready ? 'downloaded' : 'available'} />
          {installing ? 'Installing…' : ready ? 'Restart to update' : 'Update available'}
        </Button>
      </Popover.Trigger>
      <Popover.Content side="bottom" align="end" onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()} {...hover}>
        <div className="grid w-80 max-w-full gap-3 text-left">
          <p className="update-heading m-0 text-sm font-medium text-base-content">{updateStatusText(state)}</p>
          {state.releaseNotes.length > 0 && (
            <div className="max-h-[min(28rem,calc(100vh-10rem))] overflow-y-auto"><ReleaseNotes state={state} /></div>
          )}
          <Button {...kind('main')} className="update-next justify-self-start" disabled={disabled} onClick={() => void run()}>
            {ready ? 'Restart now' : 'Download'}
          </Button>
        </div>
      </Popover.Content>
    </Popover>
  );
}

export function UpdateButton() {
  const { state, follow } = useUpdateStore();
  useEffect(follow, [follow]);
  const pill = resolveUpdatePill(state);
  if (!boardApp() || !state || pill === 'none') return null;
  if (pill === 'downloading') return <Downloading state={state} />;
  return <NextStep state={state} ready={pill === 'ready'} />;
}
