// What sits around a piece of work's Start (board/items.css): the group that holds it, the tag that takes its place once
// a thread started, and the line under it with Start's message or error.

import { Alert, DismissButton } from '@lar-works/design-system';
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
    ref?: Ref<HTMLDivElement>;
    /** Makes the line focusable from script, as -1. */
    tabIndex?: number;
    /** Start's message or error, or what Auto-build says. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} ref={ref} tabIndex={tabIndex} className="start">
            {children}
        </div>
    );
}

/** An action's error, on its own line after the controls beside it: the design system's compact danger Alert, announced
 *  as it appears, with a close button named by `dismissLabel` when it can be closed. */
export function ActionError({
    ref,
    dismissLabel,
    onDismiss,
    children,
}: {
    /** The alert's element, for moving focus to it. */
    ref?: Ref<HTMLDivElement>;
    /** Names the close button, such as "Dismiss error for #61". */
    dismissLabel?: string;
    /** Called as the reader closes the error; none leaves it without a close button. */
    onDismiss?: () => void;
    /** The error. */
    children: ReactNode;
}) {
    return (
        <div data-action-error className="min-w-0 basis-full">
            <Alert
                ref={ref}
                presentation="inline"
                tone="danger"
                message={children}
                action={
                    onDismiss ? (
                        <DismissButton label={dismissLabel ?? 'Dismiss'} placement="inline" onClick={onDismiss} />
                    ) : undefined
                }
            />
        </div>
    );
}
