import { Alert } from '@lar-works/design-system';
import type { ReactNode } from 'react';

/** A row's actions at its right, with what they last did and an error under them. */
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
            <span className="flex flex-wrap items-center gap-2">{children}</span>
            {below}
            {error && <Alert size="sm" tone="danger" message={error} />}
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
