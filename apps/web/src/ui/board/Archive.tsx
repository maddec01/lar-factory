import type { ReactNode } from 'react';

import { ActionError } from './StartControls';

/** An archived row's one line: its kind and where its ticket is saved (`source`), its reference and title (an
 *  ItemTitle), taking the room and truncating first with its tooltip (`name`) giving it whole, then its project on a
 *  6rem track that lines up down the list, then where it stands, only when that says more than its section's heading
 *  (such as the day finished work closed, or the work it merged into). */
export function ArchiveLine({
    source,
    name,
    title,
    project,
    state,
}: {
    /** Its kind mark and where its ticket is saved, a SourceIcon, before its title. */
    source: ReactNode;
    /** Its reference and title in full, as the title's tooltip. */
    name: string;
    /** Its reference and title, an ItemTitle. */
    title: ReactNode;
    /** Its project, a RepoCell. */
    project: ReactNode;
    /** Where it stands, when its section's heading doesn't say it, such as "Oct 1"; none otherwise. */
    state?: string | undefined;
}) {
    return (
        <span
            className={`grid min-w-0 flex-1 items-center gap-3 ${state ? 'grid-cols-[minmax(0,1fr)_6rem_minmax(0,auto)]' : 'grid-cols-[minmax(0,1fr)_6rem]'}`}
            data-archive-line
        >
            <span className="flex min-w-0 items-center gap-2">
                <span className="text-fg-muted flex shrink-0 items-center gap-2">{source}</span>
                <span className="min-w-0 truncate" title={name} data-archive-title>
                    {title}
                </span>
            </span>
            <span className="text-fg-soft flex min-w-0 text-xs font-normal">{project}</span>
            {state && (
                <span
                    className="text-fg-muted max-w-40 min-w-0 truncate text-xs font-normal tabular-nums"
                    title={state}
                    data-archive-state
                >
                    {state}
                </span>
            )}
        </span>
    );
}

/** A row's actions at its right on one line, sized to them, with what they last did and an error under them. */
export function ActionStack({
    children,
    below,
    error,
}: {
    /** The row's actions. */
    children: ReactNode;
    /** What the actions last did, under them. */
    below?: ReactNode;
    /** Why the last action failed, under them. */
    error?: string | null;
}) {
    return (
        <span className="flex flex-col items-end gap-1">
            <span className="flex items-center justify-end gap-1">{children}</span>
            {below}
            {error && <ActionError>{error}</ActionError>}
        </span>
    );
}

/** A setting's confirmation, inline under it, before it saves: what it would do now, the work it names, and the
 *  buttons that cancel or go ahead. */
export function SettingConfirm({
    label,
    message,
    items,
    actions,
}: {
    /** Names the confirmation for screen readers. */
    label: string;
    /** What saving the setting would do now. */
    message: string;
    /** The work the setting would touch, listed. */
    items: readonly string[];
    /** The buttons that cancel or go ahead. */
    actions: ReactNode;
}) {
    return (
        <div
            className="border-line grid gap-2 rounded-lg border p-3 text-sm"
            role="alertdialog"
            aria-label={label}
            data-delete-confirm
        >
            <p className="m-0">{message}</p>
            {items.length > 0 && (
                <ul className="m-0 grid gap-0.5 pl-4">
                    {items.map((item, index) => (
                        <li key={index}>{item}</li>
                    ))}
                </ul>
            )}
            <span className="flex gap-2">{actions}</span>
        </div>
    );
}

/** What a setting's last run did, and each thing it kept with why. */
export function SettingLastRun({
    summary,
    kept,
}: {
    /** What the last run did, in a sentence. */
    summary: string;
    /** Each thing it kept, with why. */
    kept: readonly string[];
}) {
    return (
        <div className="text-fg-muted grid gap-1 text-xs" data-last-delete>
            <p className="m-0">{summary}</p>
            {kept.length > 0 && (
                <ul className="m-0 grid gap-0.5 pl-4">
                    {kept.map((line, index) => (
                        <li key={index}>{line}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}
