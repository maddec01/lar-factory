// Lar Factory's onboarding: the empty board's area, the cards of Projects still setting up, the setup dialog's
// progress and steps, and the T3 projects its first step lists.

import { Badge } from '@lar-works/design-system';
import { FolderPlusIcon } from '@lar-works/design-system/icons';
import { ScrollFadeRegion } from '@lar-works/design-system/primitives';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The board's main area while it has nothing to show, such as before its first Project: it scrolls on its own. */
export function EmptyBoard({
    children,
    ...data
}: {
    /** What the board says and offers, such as adding a first Project. */
    children: ReactNode;
} & DataAttributes) {
    return (
        // An empty board's main area: the page itself, no fade.
        <div {...data} data-scroll-fade="exempt" className="min-h-0 flex-1 overflow-y-auto">
            {children}
        </div>
    );
}

/** The cards of Projects still setting up, above the board: at most about a third of its height, then scrolling. */
export function SetupCardList({
    children,
}: {
    /** The setup cards. */
    children: ReactNode;
}) {
    return <ScrollFadeRegion className="grid max-h-[35%] shrink-0 gap-2">{children}</ScrollFadeRegion>;
}

/** The setup dialog's place under its title: the Project's `icon` beside the `place` line, over the `progress` bar. */
export function SetupHeader({
    icon,
    place,
    progress,
}: {
    /** The Project's icon. */
    icon?: ReactNode;
    /** Where the Project is, such as its path. */
    place: ReactNode;
    /** The setup's progress bar. */
    progress: ReactNode;
}) {
    return (
        <div className="grid shrink-0 gap-2 px-5 pb-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-2">
                {icon}
                {place}
            </div>
            {progress}
        </div>
    );
}

/** A setup step's parts, one under the other: close together for a list of `checks`, further apart for a `form`'s
 *  groups. */
export function SetupStep({
    presentation = 'checks',
    children,
    ...data
}: {
    /** `checks` sets a list of checks close together; `form` spaces a form's groups apart. */
    presentation?: 'checks' | 'form';
    /** The step's parts. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className={`grid min-w-0 ${presentation === 'form' ? 'gap-5' : 'gap-3'}`}>
            {children}
        </div>
    );
}

/**
 * A T3 project on one line: its `icon`, its `name` and `badge`, then its `path`, which gives way first, with the
 * `fullPath` on hover and for screen readers. A long name leaves room for some path beside the badge on a narrow page,
 * and takes at most half the line from sm up.
 */
export function ProjectLine({
    icon,
    name,
    badge,
    path,
    fullPath,
}: {
    /** The project's icon. */
    icon: ReactNode;
    /** The project's name. */
    name: string;
    /** A badge after the name, such as "Added". */
    badge?: string | null | undefined;
    /** The project's path, which gives way first. */
    path: string;
    /** The path in full, on hover and for screen readers. */
    fullPath: string;
}) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
            {icon}
            <span title={name} className="max-w-[30%] shrink-0 truncate font-medium sm:max-w-1/2">
                {name}
            </span>
            {badge && (
                <span className="shrink-0 whitespace-nowrap">
                    <Badge>{badge}</Badge>
                </span>
            )}
            <span
                data-project-path
                aria-hidden
                title={fullPath}
                className="text-fg-muted min-w-0 flex-1 truncate text-xs"
            >
                {path}
            </span>
            <span className="sr-only">{fullPath}</span>
        </span>
    );
}

/** The choice that adds a folder as a new project: the folder icon, its `title`, then a muted `hint` that gives way. */
export function AddFolderLine({
    title,
    hint,
}: {
    /** The choice's title, such as "Add a folder". */
    title: string;
    /** A muted hint after it, which gives way. */
    hint: string;
}) {
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2">
            <FolderPlusIcon aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 font-medium wrap-anywhere">{title}</span>
            <span className="text-fg-muted min-w-0 flex-1 truncate text-xs">{hint}</span>
        </span>
    );
}

/** What a choice asks for once picked, such as the folder to add, framed under the choices. */
export function ChoiceDetails({
    children,
}: {
    /** What the choice asks for, such as the folder to add. */
    children: ReactNode;
}) {
    return <div className="grid gap-3 rounded-lg border p-3">{children}</div>;
}

/** A list of projects that can't be picked, such as in a framed Disclosure. */
export function ProjectList({
    children,
}: {
    /** The projects, one ProjectListItem each. */
    children: ReactNode;
}) {
    return <ul className="m-0 grid min-w-0 list-none gap-2 p-0">{children}</ul>;
}

/** A project in a ProjectList, with the `reason` it can't be picked under it, lined up with its name. */
export function ProjectListItem({
    reason,
    children,
}: {
    /** Why the project can't be picked. */
    reason?: string | undefined;
    /** The project, a ProjectLine. */
    children: ReactNode;
}) {
    if (reason === undefined) return <li className="flex min-w-0">{children}</li>;

    return (
        <li className="grid min-w-0 gap-0.5">
            {children}
            <span className="text-fg-muted pl-6 text-xs">{reason}</span>
        </li>
    );
}
