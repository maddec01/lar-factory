import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

const headings = {
    section: 'm-0 text-sm font-medium',
    muted: 'm-0 text-sm font-medium text-fg-muted',
    label: 'm-0 text-sm font-medium text-fg-soft',
    /** A form field's label, as the design system's fields draw theirs: 12/500. */
    field: 'm-0 text-xs font-medium text-fg-soft',
} as const;

/** A section's heading: the sentence-case `label` every section of the item dialog shares (description, record,
 *  comments, working agents, the sidebar's lists), a `muted` one over a description's own section such as Acceptance
 *  Criteria, a form's `field` label (Add item's Project and Kind), or a plain `section` one. `as` a `label` it names the field `htmlFor` names, or
 *  as a `span` a group that names itself. */
export function DetailsHeading({
    presentation = 'section',
    as = 'h2',
    htmlFor,
    children,
}: {
    /** The heading's style by where it sits. */
    presentation?: keyof typeof headings;
    /** The element it renders: `label` for a field's heading, `h2` for a section's, `span` otherwise. */
    as?: 'h2' | 'label' | 'span';
    /** The id of the control a `label` heading labels. */
    htmlFor?: string | undefined;
    /** The heading's sentence-case text. */
    children: ReactNode;
}) {
    if (as === 'label')
        return (
            <label htmlFor={htmlFor} className={headings[presentation]}>
                {children}
            </label>
        );

    if (as === 'span') return <span className={headings[presentation]}>{children}</span>;

    return <h2 className={headings[presentation]}>{children}</h2>;
}

/** A sidebar section, or a section of the body such as a concept's parts: its heading over its content. */
export function DetailsSection({
    heading,
    children,
    ...data
}: {
    /** The section's heading, a DetailsHeading; none when what sits just above already names it. */
    heading?: ReactNode;
    /** The section's content. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <section {...data} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {heading && <DetailsHeading presentation="label">{heading}</DetailsHeading>}
            {children}
        </section>
    );
}

/** A section of the description, such as Acceptance Criteria: its muted heading over its text. */
export function TextSection({
    heading,
    children,
}: {
    /** The section's heading, such as "Acceptance Criteria". */
    heading: ReactNode;
    /** The section's text. */
    children: ReactNode;
}) {
    return (
        <section className="grid min-w-0 gap-2">
            <DetailsHeading presentation="muted">{heading}</DetailsHeading>
            {children}
        </section>
    );
}

/**
 * A section of the main column, beside the sidebar: the record, description or comments, its `header` over its
 * content. When it `fill`s, its content takes the height left.
 */
export function MainSection({
    as: Tag = 'div',
    header,
    fill = false,
    children,
    ...data
}: {
    /** The element it renders: `section` when it has a heading of its own. */
    as?: 'div' | 'section';
    /** The section's header, a SectionHeader. */
    header: ReactNode;
    /** Its content takes the height left in the dialog, as an open editor does. */
    fill?: boolean;
    /** The section's content. */
    children: ReactNode;
} & DataAttributes) {
    return (
        <Tag
            {...data}
            className={`grid min-w-0 gap-2 ${fill ? 'min-h-0 grid-rows-[auto_minmax(0,1fr)]' : ''} @split:col-start-1`}
        >
            {header}
            {children}
        </Tag>
    );
}

/** A main section's header row: its sentence-case `heading`, then what an `empty` section says, then its actions at the
 *  end. An empty section is that one line, so "No description." or "No comments." never takes a block of its own. */
export function SectionHeader({
    heading,
    empty,
    children,
}: {
    /** The section's sentence-case heading. */
    heading: ReactNode;
    /** What the section says when it has nothing to show, such as "No comments.", muted beside its heading. */
    empty?: ReactNode;
    /** The section's actions, at the header's end. */
    children?: ReactNode;
}) {
    return (
        <div className="flex h-7 items-center justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-3">
                <DetailsHeading presentation="label">{heading}</DetailsHeading>
                {empty && <span className="text-fg-muted min-w-0 truncate text-sm">{empty}</span>}
            </span>
            {children && <span className="flex min-w-0 items-center gap-3">{children}</span>}
        </div>
    );
}

/** A short status in a section's header, such as a save that could not be read back, truncating. */
export function HeaderStatus({
    children,
}: {
    /** The status, such as a save that could not be read back. */
    children: string;
}) {
    return (
        <span className="text-fg-muted truncate text-xs" role="status" title={children}>
            {children}
        </span>
    );
}

/** A placeholder that keeps the main column's place while the details load. */
export function MainColumnSlot({
    children,
}: {
    /** The placeholder. */
    children: ReactNode;
}) {
    return <div className="@split:col-start-1">{children}</div>;
}
