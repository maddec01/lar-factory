// The title bar's update button: T3 Code's update pill, copied from
// apps/web/src/components/sidebar/SidebarUpdatePill.tsx at 9a391eb. One round icon button that the board app
// always shows: click to check, download or install, with the tooltip saying which, and T3's toasts from the
// store. Installing asks first in the app's native dialog, as T3 does. Without T3's "update everything" run and
// its Intel build warning. The store keeps the board's own install flag: while the app installs, the button keeps
// the downloaded look, disabled.
// Hovering or focusing it opens the changelog of the Releases since the running version below it, on both
// channels where T3 shows it on nightly only, as T3 Code's SidebarUpdateReleaseNotes. It is a PreviewCard, not
// a Popover, as a Popover's focus guards would take the Tab after the button and close it.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see app/LICENSE.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { PreviewCard } from '@base-ui/react/preview-card';
import { Tooltip } from '@base-ui/react/tooltip';
import { boardApp, type UpdateState } from './board-app.ts';
import { useUpdateStore } from './update-store.ts';
import {
  canCheckForUpdate,
  getUpdateButtonTooltip,
  getUpdateIdleTooltip,
  getUpdateInstallConfirmationMessage,
  isUpdateButtonDisabled,
  resolveUpdateButtonAction,
} from './update-button-logic.ts';
import {
  shouldContinueCheckAnimation,
  shouldShowCheckIcon,
  UpdateStatusIcon,
  type UpdateStatusIconState,
} from './UpdateStatusIcon.tsx';
import { errorMessage, toastUpdateError } from './update-toasts.tsx';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Each Release's changes, newest Release first, with what the app left out. */
function ReleaseNotes({ state }: { state: UpdateState }) {
  return (
    <>
      {state.releaseNotes.map((note, index) => {
        const omitted = note.totalItems - note.items.length;
        return (
          <section key={note.version}>
            <h3>{index === 0 ? 'What\'s changed' : `Changes in ${note.version}`}</h3>
            <ul>{note.items.map((item, i) => <li key={i}>{item}</li>)}</ul>
            {omitted > 0 && <p className="update-notes-more">{plural(omitted, 'more change')} in this Release</p>}
          </section>
        );
      })}
      {state.omittedReleaseCount > 0 && <p className="update-notes-more">{plural(state.omittedReleaseCount, 'older Release')} not shown</p>}
    </>
  );
}

/** The space between the button and its changelog or tooltip, so either starts 4 px below the title bar the button sits in. */
function gapBelowTitleBar(button: HTMLElement | null): number {
  const bar = button?.closest('.title-bar');
  if (!button || !bar) return 4;
  return Math.max(4, bar.getBoundingClientRect().bottom + 4 - button.getBoundingClientRect().bottom);
}

export function UpdateButton() {
  const { state, installing, follow, check, download, install } = useUpdateStore();
  useEffect(follow, [follow]);
  const [isActionPending, setIsActionPending] = useState(false);
  const [checkAnimationKey, setCheckAnimationKey] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  // The spin finishes its turn before the icon shows the check's outcome.
  const updateStatus = state?.status;
  const [isCheckAnimationLatched, setIsCheckAnimationLatched] = useState(
    () => !prefersReducedMotion && updateStatus === 'checking',
  );
  const [latchInputs, setLatchInputs] = useState({ prefersReducedMotion, updateStatus });
  if (latchInputs.prefersReducedMotion !== prefersReducedMotion || latchInputs.updateStatus !== updateStatus) {
    setLatchInputs({ prefersReducedMotion, updateStatus });
    if (prefersReducedMotion) {
      setIsCheckAnimationLatched(false);
    } else if (updateStatus === 'checking') {
      setIsCheckAnimationLatched(true);
    }
  }

  const action = state ? resolveUpdateButtonAction(state) : 'none';
  const isDownloading = state?.status === 'downloading';
  const showCheckIcon = shouldShowCheckIcon({
    isAnimationLatched: isCheckAnimationLatched,
    isChecking: state?.status === 'checking',
    prefersReducedMotion,
  });
  const showUpdateDetails = action !== 'none' || isDownloading || installing;
  const iconStatus: UpdateStatusIconState = showCheckIcon
    ? 'checking'
    : isDownloading
      ? 'downloading'
      : action === 'install' || installing
        ? 'downloaded'
        : action === 'download'
          ? 'available'
          : 'idle';
  const showUpdateIconState = showUpdateDetails && !showCheckIcon;
  const idleTooltip = !showUpdateDetails && !showCheckIcon ? getUpdateIdleTooltip(state) : null;
  const tooltip = installing
    ? 'Installing…'
    : showUpdateDetails
      ? state
        ? getUpdateButtonTooltip(state)
        : 'Update available'
      : showCheckIcon
        ? 'Checking for updates…'
        : (idleTooltip?.title ?? 'Check for updates');
  const disabled = showCheckIcon
    ? true
    : showUpdateDetails
      ? isUpdateButtonDisabled(state) || installing
      : !canCheckForUpdate(state);
  const isInteractionDisabled = disabled || isActionPending;
  const showReleaseNotes = showUpdateDetails && !!state && state.releaseNotes.length > 0;
  const notesOpen = showReleaseNotes && (hovered || focused);

  const handleAction = async () => {
    const bridge = boardApp();
    if (isInteractionDisabled || !bridge || !state) return;
    setIsActionPending(true);
    if (action === 'download') {
      void download().finally(() => setIsActionPending(false));
      return;
    }
    if (action === 'install') {
      let confirmed = false;
      try {
        confirmed = await bridge.confirmRestart(getUpdateInstallConfirmationMessage(state));
      } catch (error) {
        setIsActionPending(false);
        toastUpdateError('Could not confirm update', errorMessage(error, 'Update confirmation failed.'));
        return;
      }
      if (!confirmed) {
        setIsActionPending(false);
        return;
      }
      void install().finally(() => setIsActionPending(false));
      return;
    }
    if (!prefersReducedMotion) {
      setIsCheckAnimationLatched(true);
      setCheckAnimationKey((key) => key + 1);
    }
    void check().finally(() => setIsActionPending(false));
  };

  const handleCheckAnimationIteration = () => {
    setIsCheckAnimationLatched(
      shouldContinueCheckAnimation({ isChecking: state?.status === 'checking', prefersReducedMotion }),
    );
  };

  // Base UI measures again whenever it places the changelog, as when the window resizes, and the bridge follows.
  const sideOffset = () => {
    const gap = gapBelowTitleBar(anchor.current);
    popup.current?.style.setProperty('--update-notes-gap', `${gap}px`);
    return gap;
  };

  if (!boardApp()) return null;

  const button = (
    <button
      type="button"
      ref={anchor}
      aria-label={idleTooltip?.detail ? `${tooltip}: ${idleTooltip.detail}` : tooltip}
      aria-disabled={isInteractionDisabled || undefined}
      aria-describedby={notesOpen ? 'update-notes' : undefined}
      className={[
        'update-button inline-flex size-8 items-center justify-center rounded-full outline-hidden ring-(--focus) transition-colors focus-visible:ring-2 focus-visible:ring-inset',
        isInteractionDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        showUpdateIconState
          ? ['bg-(--update-surface) text-(--fg)', !isInteractionDisabled && 'hover:bg-(--update-hover)']
          : ['text-(--update-icon)', !isInteractionDisabled && 'hover:bg-(--update-hover) hover:text-(--fg)'],
        disabled && !showUpdateIconState && 'opacity-60',
      ].flat().filter(Boolean).join(' ')}
      onClick={() => void handleAction()}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <UpdateStatusIcon
        key={showCheckIcon ? checkAnimationKey : iconStatus}
        downloadPercent={state?.downloadPercent ?? null}
        isCheckAnimating={showCheckIcon && !prefersReducedMotion}
        onCheckAnimationIteration={handleCheckAnimationIteration}
        status={iconStatus}
      />
    </button>
  );

  // The popup is in <body>, but React's events still bubble from it here, so the pointer on it counts as on the button.
  return (
    <span className="update"
      onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType !== 'touch' && setHovered(false)}>
      <Tooltip.Root disabled={showReleaseNotes}>
        <Tooltip.Trigger render={button} />
        {!showReleaseNotes && (
          <Tooltip.Portal>
            <Tooltip.Positioner
              className="pointer-events-none z-[140] h-(--positioner-height) w-(--positioner-width) max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
              collisionPadding={5} align="center" side="bottom" sideOffset={() => gapBelowTitleBar(anchor.current)}>
              <Tooltip.Popup className={[
                'update-tooltip relative flex h-(--popup-height,auto) w-(--popup-width,auto) origin-(--transform-origin) text-balance rounded-md text-(--fg) text-xs transition-[width,height,scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]',
                showUpdateDetails
                  ? 'dropdown-glass shadow-xl shadow-black/25 before:hidden'
                  : 'border border-(--bd) bg-(--surface) not-dark:bg-clip-padding shadow-md/5',
                'max-w-80 wrap-anywhere whitespace-normal leading-snug',
              ].join(' ')}>
                <div className="relative size-full overflow-clip px-2 py-1">
                  {idleTooltip?.detail ? (
                    <div className="text-left">
                      <div className="font-medium">{idleTooltip.title}</div>
                      <div className="text-(--muted)">{idleTooltip.detail}</div>
                    </div>
                  ) : (
                    <span className="whitespace-pre-line">{tooltip}</span>
                  )}
                </div>
              </Tooltip.Popup>
            </Tooltip.Positioner>
          </Tooltip.Portal>
        )}
      </Tooltip.Root>
      <PreviewCard.Root open={notesOpen} onOpenChange={(next) => {
        if (!next) { setHovered(false); setFocused(false); }
      }}>
        <PreviewCard.Portal>
          <PreviewCard.Positioner className="update-notes-positioner" side="bottom" align="end" sideOffset={sideOffset} anchor={anchor}>
            <PreviewCard.Popup className="update-notes" id="update-notes" ref={popup}>
              <p className="update-notes-title">{tooltip}</p>
              {state && <ReleaseNotes state={state} />}
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </span>
  );
}
