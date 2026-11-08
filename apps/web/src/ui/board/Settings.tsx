// Lar Factory's settings: the title bar's button that opens them, the sections' sidebar, the column of a page's groups,
// the short reason a setting can't be changed, and the parts its rows show under and beside their controls.

import { HelpTip, TitleBarSettingsButton } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The title bar's last button, which opens Settings: the design system's TitleBarSettingsButton, the same as
 *  lar-server's. */
export function OpenSettingsButton({
    label,
    onOpen,
}: {
    /** The button's accessible name, such as "Settings". */
    label: string;
    /** Called as the reader opens Settings. */
    onOpen: () => void;
}) {
    return <TitleBarSettingsButton label={label} onOpen={onOpen} />;
}

/**
 * Why a setting can't be changed, in a short muted line that wraps: the `reason`, a help popover with the whole
 * `explanation` (`helpLabel` names its button), then the `action` that checks again, such as an InlineLink with `onClick`.
 */
export function ReasonNote({
    reason,
    explanation,
    helpLabel,
    action,
}: {
    /** Why the setting can't be changed, in a short line. */
    reason: string;
    /** The whole explanation, in the help popover. */
    explanation: ReactNode;
    /** The help button's accessible name. */
    helpLabel: string;
    /** What the reader can do about it, after the reason. */
    action?: ReactNode;
}) {
    return (
        <span className="text-fg-muted inline-flex min-w-0 flex-wrap items-center gap-1 text-xs">
            <span>{reason}</span>
            <HelpTip label={helpLabel}>{explanation}</HelpTip>
            {action}
        </span>
    );
}

/** A settings group's note under its panel, such as what the group's last call did: small lines, stacked. `busy` marks
 *  it as still loading for assistive technology. */
export function SettingsNote({
    busy,
    children,
    ...data
}: {
    /** The note is still loading, for assistive technology. */
    busy?: boolean;
    /** The note's lines. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid gap-2 px-1" aria-busy={busy}>
            {children}
        </div>
    );
}

/** What a setting row shows under its control, such as an install's progress, in small stacked lines; `breaks` lets a
 *  long path break anywhere. */
export function SettingDetails({
    breaks = false,
    children,
}: {
    /** Lets a long path break anywhere. */
    breaks?: boolean;
    /** The details' lines, such as an install's progress. */
    children: ReactNode;
}) {
    return <div className={`grid gap-2 text-xs${breaks ? ' [overflow-wrap:anywhere]' : ''}`}>{children}</div>;
}

/** A setting's control with its error under it, at most 20rem wide. */
export function SettingControl({
    children,
}: {
    /** The control and its error. */
    children: ReactNode;
}) {
    return <div className="grid max-w-80 gap-2">{children}</div>;
}

/** A small list of each Project's value for a setting, the Project left and its value muted right, wrapping. */
export function ProjectValueList({
    label,
    rows,
}: {
    /** Names the list for screen readers. */
    label: string;
    /** Each Project with its value. */
    rows: readonly { key: string; name: string; value: string }[];
}) {
    return (
        <ul className="m-0 grid list-none gap-1 p-0 text-xs" aria-label={label}>
            {rows.map(({ key, name, value }) => (
                <li key={key} className="flex flex-wrap justify-between gap-x-3">
                    <span className="[overflow-wrap:anywhere]">{name}</span>{' '}
                    <span className="text-fg-muted [overflow-wrap:anywhere]">{value}</span>
                </li>
            ))}
        </ul>
    );
}
