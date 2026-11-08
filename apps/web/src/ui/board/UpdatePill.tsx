// The title bar's update pill, from T3 Code's update pill (apps/web/src/components/sidebar/SidebarUpdatePill.tsx at
// d53873b) and its status icon (DesktopUpdateStatusIcon.tsx at 9a391eb), drawn as the board's other App controls are,
// tinted in every state, instead of as T3's pill. Copyright (c) 2026 T3 Tools Inc. MIT License.

import { Popover, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { ArrowDownToLineIcon, RotateCcwIcon } from '@lar-works/design-system/icons';
import { ButtonBase as Button, ScrollFadeRegion } from '@lar-works/design-system/primitives';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';

import { buttonKind } from './ButtonKinds';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CLOSE_DELAY_MS = 150;

/** The pill's icon: an arrow for an available update, a progress ring in the primary colour while it downloads, and a
 *  restart arrow once it's downloaded. 16 px, as every title bar icon is. */
function UpdateStatusIcon({
    status,
    percent = 0,
}: {
    /** The update's step: `available`, `downloading` or `downloaded`. */
    status: 'available' | 'downloading' | 'downloaded';
    /** The download's whole percentage, 0 to 100. */
    percent?: number;
}) {
    if (status === 'downloading')
        return (
            <svg aria-hidden="true" className="size-4 shrink-0 -rotate-90" viewBox="0 0 20 20">
                <circle
                    cx="10"
                    cy="10"
                    r={RADIUS}
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.2"
                    strokeWidth="2"
                />
                <circle
                    cx="10"
                    cy="10"
                    r={RADIUS}
                    fill="none"
                    className="stroke-primary transition-[stroke-dashoffset] duration-(--motion-duration-slow) ease-out motion-reduce:transition-none"
                    strokeDasharray={CIRCUMFERENCE}
                    strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
                    strokeLinecap="round"
                    strokeWidth="2"
                />
            </svg>
        );

    const Icon = status === 'downloaded' ? RotateCcwIcon : ArrowDownToLineIcon;

    return <Icon className="size-4 shrink-0" aria-hidden="true" />;
}

/** The pill while the update downloads: nothing to click, a progress bar to screen readers, with more in its tooltip.
 *  `text` is what it says before the percentage, `label` its accessible name. */
export function UpdateDownloading({
    percent,
    text,
    label,
    tooltip,
}: {
    /** How much has downloaded, 0 to 100. */
    percent: number;
    /** What it says before the percentage, such as "Downloading". */
    text: string;
    /** Names the progress bar for screen readers. */
    label: string;
    /** More on the download, in the tooltip. */
    tooltip: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    role="progressbar"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    data-kind="control"
                    className="update-button text-primary-fg focus-ring bg-primary-surface hover:bg-primary-surface-hover inline-flex h-7 items-center gap-1.5 rounded-md px-2.75 text-xs font-medium"
                >
                    <UpdateStatusIcon status="downloading" percent={percent} />
                    {text} <span className="w-7 tabular-nums">{percent}%</span>
                </span>
            </TooltipTrigger>
            <TooltipPopup side="bottom">{tooltip}</TooltipPopup>
        </Tooltip>
    );
}

/** Open while the pointer is on the pill or its popover, and for 150 ms after it leaves both. */
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

interface UpdatePillProps {
    /** Whether the update is downloaded and waits for a restart, or still to download. */
    status: 'available' | 'downloaded';
    /** What the pill says, such as "Update available" or "Installing…". */
    label: string;
    /** The popover's heading, such as "Lar Factory 1.4.0 is available". */
    heading: string;
    /** The update's changes, such as ReleaseNotes. */
    notes?: ReactNode;
    /** The popover's button, such as "Download". */
    actionLabel: string;
    /** The step can't run now. */
    disabled: boolean;
    /** Runs the step: the pill and the popover's button both run it. */
    onRun: () => void;
}

/**
 * The pill with an update to download or install. Clicking it runs that step. Hovering it, or focusing it from the
 * keyboard, opens the changelog below it, with the step's button; it closes 150 ms after the pointer leaves both, and
 * on Escape. The focus stays on the pill.
 */
export function UpdatePill({ status, label, heading, notes, actionLabel, disabled, onRun }: UpdatePillProps) {
    const { open, show, close, hover } = useHoverOpen();

    return (
        <Popover open={open} onOpenChange={(next) => !next && close()}>
            <Popover.Trigger asChild>
                <Button
                    {...buttonKind('control')}
                    variant="tinted"
                    aria-disabled={disabled || undefined}
                    className={`update-button gap-1.5 font-medium ${disabled ? 'cursor-not-allowed' : ''}`}
                    // The pill runs the step; the changelog opens on hover and focus, not on the click.
                    onClick={(event) => {
                        event.preventDefault();

                        if (!disabled) onRun();
                    }}
                    onFocus={(event) => event.currentTarget.matches(':focus-visible') && show()}
                    {...hover}
                >
                    <UpdateStatusIcon status={status} />
                    {label}
                </Button>
            </Popover.Trigger>
            <Popover.Content
                side="bottom"
                align="end"
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                {...hover}
            >
                <div className="grid w-80 max-w-full gap-3 text-left">
                    <p className="update-heading text-fg m-0 text-sm font-medium">{heading}</p>
                    {notes ? (
                        <ScrollFadeRegion className="max-h-[min(28rem,calc(100vh-10rem))]">{notes}</ScrollFadeRegion>
                    ) : null}
                    <span className="justify-self-start">
                        <Button {...buttonKind('main')} className="update-next" disabled={disabled} onClick={onRun}>
                            {actionLabel}
                        </Button>
                    </span>
                </div>
            </Popover.Content>
        </Popover>
    );
}

export interface ReleaseNote {
    version: string;
    /** The section's heading, such as "What's changed" or "Changes in 1.3.0". */
    title: string;
    items: readonly string[];
    /** What the app left out, such as "3 more changes in this Release". */
    more?: string;
}

/** Each Release's changes, newest first, and a note of older Releases left out. */
export function ReleaseNotes({
    releases,
    older,
}: {
    /** Each Release with its changes, newest first. */
    releases: readonly ReleaseNote[];
    /** A note of older Releases left out. */
    older?: string;
}) {
    return (
        <>
            {releases.map((note) => (
                <section
                    className="not-first:border-line not-first:mt-3 not-first:border-t not-first:pt-3"
                    key={note.version}
                >
                    <h3 className="text-fg m-0 text-xs leading-4 font-semibold">{note.title}</h3>
                    <ul className="text-fg-muted m-0 mt-2 space-y-1.5 pl-4 text-xs leading-5">
                        {note.items.map((item, i) => (
                            <li className="list-disc break-words" key={i}>
                                {item}
                            </li>
                        ))}
                    </ul>
                    {note.more ? <p className="text-fg-muted m-0 mt-2 text-xs leading-5">{note.more}</p> : null}
                </section>
            ))}
            {older ? (
                <p className="border-line text-fg-muted m-0 mt-3 border-t pt-3 text-xs leading-5">{older}</p>
            ) : null}
        </>
    );
}
