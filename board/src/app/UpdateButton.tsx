// The header's update button, shown once the app's updater finds a newer Release: Update downloads it
// with progress, then Install and restart quits into it, showing Installing until the app quits. A failed
// download or install shows with a retry.
// It shows the states T3 Code's update button shows. Hovering or focusing it opens the changelog of the
// Releases since the running version, as T3 Code's SidebarUpdateReleaseNotes. It is a PreviewCard, not a
// Popover, as a Popover's focus guards would take the Tab after the button and close it.

import { useEffect, useRef, useState } from 'react';
import { PreviewCard } from '@base-ui/react/preview-card';
import type { UpdateState } from './board-app.ts';
import { useUpdateStore, type UpdateStore } from './update-store.ts';

interface UpdateAction { label: string; run?: () => unknown; title?: string; tone?: 'error' }

/** The status the button shows: a check every 4 minutes keeps showing the update it already found. */
function shownStatus(state: UpdateState): UpdateState['status'] {
  if (state.status !== 'checking') return state.status;
  if (state.downloadedVersion !== null) return 'downloaded';
  if (state.availableVersion !== null) return 'available';
  return 'checking';
}

/** What the button shows and does in `state`, or null when it doesn't show. */
function actionFor(state: UpdateState, store: UpdateStore): UpdateAction | null {
  const { installing, download, install } = store;
  const version = state.downloadedVersion ?? state.availableVersion;
  if (installing) return { label: 'Installing…', title: `Quits and opens ${version}.` };
  // A failed download keeps the update available and a failed install keeps it downloaded, with the error.
  if ((state.errorContext === 'download' || state.errorContext === 'install') && state.message !== null) {
    const failedInstall = state.errorContext === 'install';
    return {
      label: 'Update failed, retry',
      run: state.canRetry ? (failedInstall ? install : download) : undefined,
      title: `Couldn't ${failedInstall ? 'install' : 'download'} ${version}: ${state.message}`,
      tone: 'error',
    };
  }
  switch (shownStatus(state)) {
    case 'available':
      return { label: `Update to ${version}`, run: download };
    case 'downloading':
      return { label: `Downloading ${Math.floor(state.downloadPercent ?? 0)}%` };
    case 'downloaded':
      return { label: 'Install and restart', run: install, title: `Quits and opens ${version}.` };
    // A failed check has no update to show; the next check tries again.
    default:
      return null;
  }
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

/** The space between the button and its changelog, so the changelog starts 4 px below the title bar the button sits in. */
function gapBelowTitleBar(button: HTMLElement | null): number {
  const bar = button?.closest('.title-bar');
  if (!button || !bar) return 4;
  return Math.max(4, bar.getBoundingClientRect().bottom + 4 - button.getBoundingClientRect().bottom);
}

export function UpdateButton() {
  const store = useUpdateStore();
  const { state, busy, follow } = store;
  useEffect(follow, [follow]);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const action = state && actionFor(state, store);
  if (!action) return null;
  const { label, run, tone } = action;
  const title = busy ? 'The updater is busy. Try again in a moment.' : action.title;
  const hasNotes = state.releaseNotes.length > 0;
  const open = hasNotes && (hovered || focused);
  // Base UI measures again whenever it places the changelog, as when the window resizes, and the bridge follows.
  const sideOffset = () => {
    const gap = gapBelowTitleBar(anchor.current);
    popup.current?.style.setProperty('--update-notes-gap', `${gap}px`);
    return gap;
  };
  // The popup is in <body>, but React's events still bubble from it here, so the pointer on it counts as on the button.
  return (
    <span className="update"
      onPointerEnter={(e) => e.pointerType !== 'touch' && setHovered(true)}
      onPointerLeave={(e) => e.pointerType !== 'touch' && setHovered(false)}>
      {/* Busy rather than disabled while it downloads or installs, so focus stays on the button. */}
      <button type="button" className="copy update-button" ref={anchor} title={hasNotes ? undefined : title}
        data-tone={tone} aria-disabled={!run} aria-describedby={open ? 'update-notes' : undefined}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onClick={() => run && void run()}>
        {label}
      </button>
      <PreviewCard.Root open={open} onOpenChange={(next) => {
        if (!next) { setHovered(false); setFocused(false); }
      }}>
        <PreviewCard.Portal>
          <PreviewCard.Positioner className="update-notes-positioner" side="bottom" align="end" sideOffset={sideOffset} anchor={anchor}>
            <PreviewCard.Popup className="update-notes" id="update-notes" ref={popup}>
              {title && <p className="update-notes-title">{title}</p>}
              <ReleaseNotes state={state} />
            </PreviewCard.Popup>
          </PreviewCard.Positioner>
        </PreviewCard.Portal>
      </PreviewCard.Root>
    </span>
  );
}
