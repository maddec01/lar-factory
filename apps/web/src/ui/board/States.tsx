// The board's shared states, one look each wherever they appear: a header line's empty note, a search or filter that
// finds nothing, and a section that failed to load.

import { ButtonLink, EmptyState, PageError } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';
import { RetryAction } from './RetryAction';

/** What a section's header line says with no rows (that it's loading, that nothing is in it, or that the filters hide
 *  every row), muted after its title. A `quiet` one (nothing in it, which its count of 0 already says) and, on a phone,
 *  every one says it to screen readers only, so the line keeps the room for the section's name. */
export function HeaderEmpty({
    quiet = false,
    children,
}: {
    /** Says it to screen readers only. */
    quiet?: boolean;
    /** What the section says, such as "Nothing in build.". */
    children: ReactNode;
}) {
    return (
        <p
            data-header-empty
            className={`text-fg-muted m-0 flex min-w-0 items-center truncate text-xs ${quiet ? 'sr-only' : 'max-sm:sr-only'}`}
        >
            {children}
        </p>
    );
}

/** A search or filter that hides everything: "Nothing matches", what to try, and Clear search. `size` is `compact` in
 *  a list or a panel, `inline` in a picker's rows. */
export function NoMatches({
    onClear,
    description,
    size = 'compact',
}: {
    /** Clears the search and the filters. */
    onClear: () => void;
    /** What the reader can try, as a sentence. */
    description?: string | undefined;
    /** The design system's empty-state scale. */
    size?: 'compact' | 'inline';
}) {
    return (
        <EmptyState
            size={size}
            title="Nothing matches"
            description={description}
            secondaryAction={{ label: 'Clear search', onAction: onClear }}
        />
    );
}

/** A section that couldn't load: "Couldn’t load `what`", the `reason`, Try again and any `link`, announced. `size` is
 *  `inline` in a section's body, `compact` for a list or a panel of its own. */
export function LoadFailed({
    what,
    reason,
    onRetry,
    retrying = false,
    link,
    size = 'inline',
    ...data
}: {
    /** What failed to load, such as "checks". */
    what: string;
    /** Why, when known. */
    reason?: string | undefined;
    /** Called as the reader tries again; none offers no retry. */
    onRetry?: (() => void) | undefined;
    /** A retry is in flight. */
    retrying?: boolean;
    /** Somewhere else to see it, such as the ticket's page, opened in a new tab. */
    link?: { label: string; href: string } | undefined;
    /** The design system's state scale. */
    size?: 'inline' | 'compact';
} & DataAttributes) {
    return (
        <div {...data} role="alert" className="min-w-0" data-load-failed>
            <PageError
                size={size}
                title={`Couldn’t load ${what}`}
                description={reason}
                actions={
                    (onRetry || link) && (
                        <>
                            {onRetry && <RetryAction size="sm" busy={retrying} onRetry={onRetry} />}
                            {link && (
                                <ButtonLink look="app" variant="secondary" size="sm" href={link.href} external>
                                    {link.label}
                                </ButtonLink>
                            )}
                        </>
                    )
                }
            />
        </div>
    );
}
