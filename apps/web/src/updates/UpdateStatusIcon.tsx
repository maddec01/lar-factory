// The update pill's icon in each state: an arrow for an available update, a progress ring while it downloads, as T3
// Code's apps/web/src/components/sidebar/DesktopUpdateStatusIcon.tsx at 9a391eb draws it, and a restart arrow once
// it's downloaded. Each is 16 px, as every title bar icon is, with the ring in the primary colour.
//
// Copyright (c) 2026 T3 Tools Inc. MIT License; the full notice is in THIRD_PARTY_NOTICES.md.

import { ArrowDownToLine, RotateCcw } from 'lucide-react';

const DOWNLOAD_PROGRESS_RADIUS = 7;
const DOWNLOAD_PROGRESS_CIRCUMFERENCE = 2 * Math.PI * DOWNLOAD_PROGRESS_RADIUS;

export type UpdateStatusIconState = 'available' | 'downloading' | 'downloaded';

function UpdateDownloadingIcon({ percent }: { readonly percent: number }) {
  const progressOffset = DOWNLOAD_PROGRESS_CIRCUMFERENCE * (1 - percent / 100);
  return (
    <svg aria-hidden="true" className="size-4 shrink-0 -rotate-90" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r={DOWNLOAD_PROGRESS_RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r={DOWNLOAD_PROGRESS_RADIUS}
        fill="none"
        className="stroke-primary transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none"
        strokeDasharray={DOWNLOAD_PROGRESS_CIRCUMFERENCE}
        strokeDashoffset={progressOffset}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}

/** `downloadPercent` is the whole percentage, 0 to 100. */
export function UpdateStatusIcon({ downloadPercent = 0, status }: { readonly downloadPercent?: number; readonly status: UpdateStatusIconState }) {
  if (status === 'downloading') return <UpdateDownloadingIcon percent={downloadPercent} />;
  const Icon = status === 'downloaded' ? RotateCcw : ArrowDownToLine;
  return <Icon className="size-4 shrink-0" aria-hidden="true" />;
}
