// The title bar's update control and release notes, ported from T3 Code's SidebarUpdatePill and
// DesktopUpdateStatusIcon. Copyright (c) 2026 T3 Tools Inc. MIT License.

import { Popover, ToolbarStatusItem, Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';
import { RotateCcwIcon } from '@lar-works/design-system/icons';
import { ButtonBase as Button, ScrollFadeRegion } from '@lar-works/design-system/primitives';
import { type ReactNode, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { buttonKind } from './ButtonKinds';
import { conceptIcons } from './ConceptIcons';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function DownloadRing({ percent }: { percent: number }) {
    return (
        <svg
            role="progressbar"
            aria-label="Update download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="size-4 shrink-0 -rotate-90"
            viewBox="0 0 20 20"
        >
            <circle cx="10" cy="10" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
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
}

interface UpdatePillProps {
    status: 'available' | 'downloading' | 'downloaded';
    percent: number;
    label: string;
    heading: string;
    detail: string;
    notes?: ReactNode;
    actionLabel: string;
    disabled: boolean;
    onRun: () => void;
}

/** A quiet icon opens anchored details. Hover only names the state; update actions stay in the popover. */
export function UpdatePill({
    status,
    percent,
    label,
    heading,
    detail,
    notes,
    actionLabel,
    disabled,
    onRun,
}: UpdatePillProps) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const ready = status === 'downloaded';

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <Tooltip disabled={open}>
                <Popover.Trigger asChild>
                    <TooltipTrigger asChild>
                        <Button
                            ref={trigger}
                            {...buttonKind('control')}
                            aria-label={label}
                            className="update-button w-7 px-0"
                        >
                            {status === 'downloading' ? (
                                <DownloadRing percent={percent} />
                            ) : (
                                <ToolbarStatusItem
                                    icon={ready ? <RotateCcwIcon /> : <conceptIcons.updates />}
                                    state={ready ? 'ready' : 'waiting'}
                                />
                            )}
                        </Button>
                    </TooltipTrigger>
                </Popover.Trigger>
                <TooltipPopup side="bottom">{label}</TooltipPopup>
            </Tooltip>
            <Popover.Content side="bottom" align="end" width="md">
                <div className="grid min-w-0 gap-3 text-left">
                    <p className="update-heading text-fg m-0 text-sm font-medium break-words">{heading}</p>
                    <p className="text-fg-muted m-0 text-xs break-words">{detail}</p>
                    {notes ? (
                        <ScrollFadeRegion className="max-h-[min(28rem,calc(100dvh-14rem))]">{notes}</ScrollFadeRegion>
                    ) : null}
                    {status !== 'downloading' && (
                        <span className="justify-self-start">
                            <Button
                                {...buttonKind('main')}
                                className="update-next"
                                disabled={disabled}
                                onClick={() => {
                                    if (ready) {
                                        flushSync(() => setOpen(false));
                                        trigger.current?.focus({ preventScroll: true });
                                    }

                                    onRun();
                                }}
                            >
                                {actionLabel}
                            </Button>
                        </span>
                    )}
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
