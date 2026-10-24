// The update button's icon in each state, copied from T3 Code's
// apps/web/src/components/sidebar/DesktopUpdateStatusIcon.tsx at 9a391eb, without the "update everything"
// icon. T3's sidebar colours are the board's --update-* colours (index.css).
//
// Copyright (c) 2026 T3 Tools Inc. Licensed under the MIT License; see app/LICENSE.

import { CheckIcon, DownloadIcon, RotateCwIcon } from 'lucide-react';
import type { AnimationEventHandler } from 'react';
import { RefreshIcon } from './refresh-icon.tsx';

const DOWNLOAD_PROGRESS_RADIUS = 14;
const DOWNLOAD_PROGRESS_CIRCUMFERENCE = 2 * Math.PI * DOWNLOAD_PROGRESS_RADIUS;

export type UpdateStatusIconState = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded';

function normalizeDownloadPercent(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

export function shouldShowCheckIcon({
  isAnimationLatched,
  isChecking,
  prefersReducedMotion,
}: {
  readonly isAnimationLatched: boolean;
  readonly isChecking: boolean;
  readonly prefersReducedMotion: boolean;
}): boolean {
  return isChecking || (isAnimationLatched && !prefersReducedMotion);
}

export function shouldContinueCheckAnimation({
  isChecking,
  prefersReducedMotion,
}: {
  readonly isChecking: boolean;
  readonly prefersReducedMotion: boolean;
}): boolean {
  return isChecking && !prefersReducedMotion;
}

function UpdateAvailableIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <DownloadIcon className="size-4" />
      <span
        aria-hidden="true"
        className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-current ring-2 ring-(--update-surface)"
      />
    </span>
  );
}

function UpdateDownloadingIcon({ percent }: { readonly percent: number | null }) {
  const normalizedPercent = normalizeDownloadPercent(percent);
  const progressOffset = DOWNLOAD_PROGRESS_CIRCUMFERENCE * (1 - normalizedPercent / 100);

  return (
    <span className="relative grid size-8 place-items-center">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r={DOWNLOAD_PROGRESS_RADIUS} fill="none" className="stroke-current/22" strokeWidth="1.5" />
        <circle
          cx="16"
          cy="16"
          r={DOWNLOAD_PROGRESS_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeDasharray={DOWNLOAD_PROGRESS_CIRCUMFERENCE}
          strokeDashoffset={progressOffset}
          strokeLinecap="round"
          strokeWidth="1.5"
          className="transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        />
      </svg>
      <DownloadIcon className="size-4" />
    </span>
  );
}

function UpdateDownloadedIcon() {
  return (
    <span className="relative grid size-4 place-items-center">
      <RotateCwIcon className="size-4" />
      <span className="absolute -right-1 -bottom-1 grid size-2.5 place-items-center rounded-full bg-(--fg) text-(--bg) ring-2 ring-(--bg)">
        <CheckIcon className="size-2" strokeWidth={3} />
      </span>
    </span>
  );
}

export function UpdateStatusIcon({
  downloadPercent,
  isCheckAnimating,
  onCheckAnimationIteration,
  status,
}: {
  readonly downloadPercent?: number | null;
  readonly isCheckAnimating?: boolean;
  readonly onCheckAnimationIteration?: AnimationEventHandler<SVGSVGElement>;
  readonly status: UpdateStatusIconState;
}) {
  if (status === 'available') return <UpdateAvailableIcon />;
  if (status === 'downloading') return <UpdateDownloadingIcon percent={downloadPercent ?? null} />;
  if (status === 'downloaded') return <UpdateDownloadedIcon />;

  return (
    <RefreshIcon
      className="size-4"
      refreshing={status === 'checking' && isCheckAnimating === true}
      onAnimationIteration={onCheckAnimationIteration}
    />
  );
}
