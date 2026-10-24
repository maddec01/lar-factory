// The title bar's update button: T3 Code's update pill, copied from
// apps/web/src/components/sidebar/SidebarUpdatePill.tsx at d53873b. One round icon button that the board app
// always shows: click to check, download or install, with the tooltip saying which, and T3's toasts from the
// store. Installing asks first in the app's native dialog, as T3 does. Without T3's "update everything" run and
// its Intel build warning. The store keeps the board's own install flag: while the app installs, the button keeps
// the downloaded look, disabled.
// An update with release notes shows them in T3's changelog popover in place of the tooltip, on both channels
// where T3 shows it on nightly only, as T3 Code's SidebarUpdateReleaseNotes. It opens on hover and on keyboard
// focus, closes 150 ms after the pointer leaves, a forward Tab moves into it, and a click runs the update. The
// title bar sits at the top, so both open below the button, where T3's open above it.
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see apps/desktop/LICENSE.

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import { flushSync } from 'react-dom';
import { boardApp, type UpdateState } from '@mux-factory/shared';
import { Popover, PopoverCreateHandle, PopoverPopup, PopoverTrigger } from '@mux-factory/ui/popover';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
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

type UpdatePopoverChangeDetails = Parameters<NonNullable<ComponentProps<typeof Popover>['onOpenChange']>>[1];
type UpdatePopoverHandle = ReturnType<typeof PopoverCreateHandle>;

function handleReleaseNotesPopoverOpenChange(
  _open: boolean,
  details: Pick<UpdatePopoverChangeDetails, 'reason' | 'cancel'>,
): void {
  if (details.reason === 'trigger-press') details.cancel();
}

function openReleaseNotesPopoverOnForwardTab(
  event: { readonly key: string; readonly shiftKey: boolean },
  handle: Pick<UpdatePopoverHandle, 'open'>,
  triggerId: string,
): void {
  if (event.key !== 'Tab' || event.shiftKey) return;
  // Hover-open popovers do not manage focus. Promote this one before native Tab runs.
  flushSync(() => handle.open(triggerId));
}

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
          <section className="not-first:mt-3 not-first:border-t not-first:pt-3" key={note.version}>
            <h3 className="font-semibold text-foreground text-xs leading-4">{index === 0 ? 'What\'s changed' : `Changes in ${note.version}`}</h3>
            <ul className="mt-2 space-y-1.5 pl-4 text-popover-foreground/90 text-xs leading-5">
              {note.items.map((item, i) => <li className="list-disc break-words" key={i}>{item}</li>)}
            </ul>
            {omitted > 0 && <p className="mt-2 text-muted-foreground text-xs leading-5">{plural(omitted, 'more change')} in this Release</p>}
          </section>
        );
      })}
      {state.omittedReleaseCount > 0 && <p className="mt-3 border-t pt-3 text-muted-foreground text-xs leading-5">{plural(state.omittedReleaseCount, 'older Release')} not shown</p>}
    </>
  );
}

/** The space between the button and its changelog or tooltip, so either starts 4 px below the title bar the button sits in.
 *  Base UI measures again whenever it places them, as when the window resizes. */
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
  const [releaseNotesPopoverHandle] = useState(() => PopoverCreateHandle());
  const suppressReleaseNotesFocusOpen = useRef(false);
  const releaseNotesPopupRef = useRef<HTMLDivElement>(null);
  const releaseNotesTriggerId = useId();
  const anchor = useRef<HTMLButtonElement>(null);
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
  const showReleaseNotesPopover = showUpdateDetails && !!state && state.releaseNotes.length > 0;

  useEffect(() => {
    if (!showReleaseNotesPopover) {
      releaseNotesPopoverHandle.close();
      return;
    }

    const trigger = document.getElementById(releaseNotesTriggerId);
    if (trigger?.matches(':focus-visible')) {
      releaseNotesPopoverHandle.open(releaseNotesTriggerId);
    }
  }, [releaseNotesPopoverHandle, releaseNotesTriggerId, showReleaseNotesPopover]);

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

  const sideOffset = () => gapBelowTitleBar(anchor.current);

  if (!boardApp()) return null;

  const updateButton = (
    <button
      type="button"
      ref={anchor}
      aria-label={idleTooltip?.detail ? `${tooltip}: ${idleTooltip.detail}` : tooltip}
      aria-disabled={isInteractionDisabled || undefined}
      className={[
        'update-button inline-flex size-8 items-center justify-center rounded-full outline-hidden ring-(--ring) transition-colors focus-visible:ring-2 focus-visible:ring-inset',
        isInteractionDisabled ? 'cursor-not-allowed' : 'cursor-pointer',
        showUpdateIconState
          ? ['bg-(--sidebar-control-surface) text-(--foreground)', !isInteractionDisabled && 'hover:bg-(--update-hover)']
          : ['text-(--sidebar-icon-color)', !isInteractionDisabled && 'hover:bg-(--update-hover) hover:text-(--foreground)'],
        disabled && !showUpdateIconState && 'opacity-60',
      ].flat().filter(Boolean).join(' ')}
      onClick={() => void handleAction()}
      onBlur={() => {
        suppressReleaseNotesFocusOpen.current = false;
      }}
      onFocus={(event) => {
        if (!showReleaseNotesPopover || !event.currentTarget.matches(':focus-visible')) return;
        if (suppressReleaseNotesFocusOpen.current) {
          suppressReleaseNotesFocusOpen.current = false;
          return;
        }
        flushSync(() => releaseNotesPopoverHandle.open(releaseNotesTriggerId));
      }}
      onKeyDown={(event) => {
        if (!showReleaseNotesPopover) return;
        openReleaseNotesPopoverOnForwardTab(event, releaseNotesPopoverHandle, releaseNotesTriggerId);
      }}
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

  // One title bar item, as T3's SidebarMenuItem, so the popover's focus guards beside the button take no gap.
  return (
    <span className="flex shrink-0">
      <Popover
        handle={releaseNotesPopoverHandle}
        onOpenChange={(open, details) => {
          if (open && !showReleaseNotesPopover) {
            details.cancel();
            return;
          }
          handleReleaseNotesPopoverOpenChange(open, details);
        }}
      >
        <Tooltip disabled={showReleaseNotesPopover}>
          <TooltipTrigger
            render={
              <PopoverTrigger
                {...(!showReleaseNotesPopover
                  ? {
                      'aria-controls': undefined,
                      'aria-expanded': undefined,
                      'aria-haspopup': undefined,
                    }
                  : {})}
                closeDelay={150}
                handle={releaseNotesPopoverHandle}
                id={releaseNotesTriggerId}
                openOnHover={showReleaseNotesPopover}
                render={updateButton}
              />
            }
          />
          {!showReleaseNotesPopover ? (
            <TooltipPopup
              align="center"
              side="bottom"
              sideOffset={sideOffset}
              variant={showUpdateDetails ? 'glass' : 'default'}
            >
              {idleTooltip?.detail ? (
                <div className="text-left">
                  <div className="font-medium">{idleTooltip.title}</div>
                  <div className="text-muted-foreground">{idleTooltip.detail}</div>
                </div>
              ) : (
                <span className="whitespace-pre-line">{tooltip}</span>
              )}
            </TooltipPopup>
          ) : null}
        </Tooltip>
        {showReleaseNotesPopover && state ? (
          // In the Mac app the changelog doesn't drag the window under it, as T3's menus don't.
          <PopoverPopup
            align="center"
            aria-label="Update release notes"
            className="[-webkit-app-region:no-drag]"
            initialFocus={false}
            onKeyDownCapture={(event) => {
              if (
                event.key === 'Escape' &&
                releaseNotesPopupRef.current?.contains(document.activeElement)
              ) {
                suppressReleaseNotesFocusOpen.current = true;
              }
            }}
            ref={releaseNotesPopupRef}
            side="bottom"
            sideOffset={sideOffset}
            tooltipStyle
          >
            <div className="flex max-h-[calc(var(--available-height)-0.5rem)] min-h-0 w-fit max-w-[min(24rem,calc(100vw-2rem))] flex-col text-left">
              <div className="shrink-0 px-1 font-medium text-sm leading-5">{tooltip}</div>
              {/* Focusable, so a forward Tab from the button lands here and the arrow keys scroll the notes. */}
              <div className="max-h-[min(28rem,calc(100vh-6rem))] min-h-0 overflow-y-auto rounded-sm px-1 pt-4 pb-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" tabIndex={0}>
                <ReleaseNotes state={state} />
              </div>
            </div>
          </PopoverPopup>
        ) : null}
      </Popover>
    </span>
  );
}
