// What sits around a piece of work's Start (board/items.css): the group that holds it, the tag that takes its place once
// a thread started, and the line under it with Start's message or error.

import type { ReactNode, Ref } from 'react';

import type { DataAttributes } from './DataAttributes';
import { StateWord } from './StateWord';

/** Start and what goes with it, at the right of its row, wrapping. */
export function StartGroup({
    children,
}: {
    /** Start and what goes with it. */
    children: ReactNode;
}) {
    return <span className="start-group">{children}</span>;
}

/** A sentence on a line of its own in StartGroup, such as "Run finished.". */
export function StartNote({
    children,
}: {
    /** The sentence, such as "Run finished.". */
    children: ReactNode;
}) {
    return <span className="basis-full">{children}</span>;
}

/** The state that takes Start's place, a light and its word: Started, or May have started while it's `unsure`. It takes focus back from a closed
 *  message, so it is focusable from script. */
export function StartTag({
    unsure = false,
    title,
    children,
    ...data
}: {
    /** Says "May have started" rather than "Started". */
    unsure?: boolean;
    /** More on the tag, as its tooltip. */
    title: string;
    /** The tag's text. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <StateWord
            {...data}
            state={unsure ? 'waiting' : 'ready'}
            className={unsure ? 'started-tag unsure' : 'started-tag'}
            tabIndex={-1}
            title={title}
        >
            {children}
        </StateWord>
    );
}

/** The small line under Start: its message or error, or what Auto-build says of the item. */
export function StartLine({
    ref,
    tabIndex,
    children,
    ...data
}: {
    /** The line's element, for moving focus to it. */
    ref?: Ref<HTMLParagraphElement>;
    /** Makes the line focusable from script, as -1. */
    tabIndex?: number;
    /** Start's message or error, or what Auto-build says. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <p {...data} ref={ref} tabIndex={tabIndex} className="start">
            {children}
        </p>
    );
}

/** An action's error in the danger text colour, on its own line after the controls beside it. */
export function ActionError({
    ref,
    role,
    children,
}: {
    /** The error's element, for moving focus to it. */
    ref?: Ref<HTMLSpanElement>;
    /** `alert` to announce the error as it appears. */
    role?: 'alert';
    /** The error. */
    children: ReactNode;
}) {
    return (
        <span ref={ref} role={role} className="action-error">
            {children}
        </span>
    );
}
