import { Button, Loading, SkeletonLoader } from '@lar-works/design-system';
import { Plus } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

import { buttonKind } from './ButtonKinds';
import type { DataAttributes } from './DataAttributes';
import { ROW_OPENS } from './RowStyles';

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

/** A sidebar section, or a section of the body such as a concept's parts: its heading over its content. An `empty`
 *  one is its heading line alone, saying so beside the heading as a main section's SectionHeader does. */
export function DetailsSection({
    heading,
    empty,
    children,
    ...data
}: {
    /** The section's heading, a DetailsHeading; none when what sits just above already names it. */
    heading?: ReactNode;
    /** What the section says when it has nothing to show, such as "No pull request yet.", muted beside its heading. */
    empty?: ReactNode;
    /** The section's content. */
    children?: ReactNode;
} & DataAttributes) {
    return (
        <section {...data} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
            {heading && empty ? (
                <SectionHeader heading={heading} empty={empty} />
            ) : (
                heading && <DetailsHeading presentation="label">{heading}</DetailsHeading>
            )}
            {!heading && empty && <SectionEmpty>{empty}</SectionEmpty>}
            {children}
        </section>
    );
}

/** What an empty section says, muted, beside its heading or in its place. */
function SectionEmpty({ children }: { children: ReactNode }) {
    return <span className="text-fg-muted min-w-0 truncate text-sm">{children}</span>;
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

/** An empty description as its section's header alone: its `heading` ("Description"), "No description yet." and Add. */
export function AddDescription({ heading = 'Description', onAdd }: { heading?: string; onAdd: () => void }) {
    return (
        // The section's own header, as a written description's, so an empty one still reads as a section: its heading,
        // a muted "No description yet." and Add where Edit would be, in Edit's button.
        <div data-description>
            <SectionHeader heading={heading} empty="No description yet." prose>
                <Button {...buttonKind('other')} leftIcon={<Plus />} onClick={onAdd}>
                    Add
                </Button>
            </SectionHeader>
        </div>
    );
}

/** A main section's header row: its sentence-case `heading`, then what an `empty` section says, then its actions at the
 *  end, which end where its prose does when it holds `prose`. An empty section is that one line, so "No description." or
 *  "No comments." never takes a block of its own. */
export function SectionHeader({
    heading,
    bar,
    empty,
    prose = false,
    children,
}: {
    /** The section's sentence-case heading. */
    heading: ReactNode;
    /** A progress bar beside the heading, such as a concept's parts, as the slices' count carries theirs. */
    bar?: ReactNode;
    /** What the section says when it has nothing to show, such as "No comments.", muted beside its heading. */
    empty?: ReactNode;
    /** The section is text, whose reading measure the header keeps, so its actions end where the lines do. */
    prose?: boolean;
    /** The section's actions, at the header's end. */
    children?: ReactNode;
}) {
    return (
        <div className={`flex h-7 items-center justify-between gap-2 ${prose ? 'max-w-reading text-sm' : ''}`}>
            <span className="flex min-w-0 items-baseline gap-3">
                <DetailsHeading presentation="label">{heading}</DetailsHeading>
                {bar && (
                    <span aria-hidden className="w-28 shrink-0 self-center">
                        {bar}
                    </span>
                )}
                {empty && <SectionEmpty>{empty}</SectionEmpty>}
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

/** The description's place while the details load: its `heading`, with the ticket's "Open in …" at the heading line's
 *  end from the start, so a slow read never leaves the reader waiting on it; under the heading, where the text will
 *  start, the small spinner and what loads from where (`children`, such as "Loading details from Azure DevOps…"), then
 *  `slow` once the read has taken a while; under that a short three-line skeleton, so the dialog doesn't jump as the
 *  text arrives. Busy, for assistive tech. */
export function DetailsLoading({
    heading,
    children,
    slow,
    source,
    href,
}: {
    /** The section's heading, such as "Description". */
    heading: string;
    /** What loads, from where, such as "Loading details from Azure DevOps…". */
    children: string;
    /** A word once the read takes long, such as "This can take a while."; absent before then. */
    slow?: string | undefined;
    /** Where the details come from, such as "Azure DevOps", which names the link to its page. */
    source?: string | undefined;
    /** The ticket's page, opened by "Open in …". */
    href?: string | undefined;
}) {
    return (
        <div className="@split:col-start-1 grid min-w-0 gap-2" aria-busy="true" data-details-loading>
            <SectionHeader heading={heading} prose>
                {href && source && (
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener"
                        className={`text-fg-soft hover:text-fg shrink-0 rounded-xs text-xs underline-offset-2 hover:underline ${ROW_OPENS}`}
                        data-details-open
                    >
                        Open in {source}
                    </a>
                )}
            </SectionHeader>
            <span
                className="text-fg-muted flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs"
                data-details-loading-line
            >
                <Loading presentation="inline" label={children} />
                {slow && <span>{slow}</span>}
            </span>
            {/* The text's shape only; the line above says what loads. */}
            <span aria-hidden="true" className="max-w-reading grid" data-details-skeleton>
                {lineWidths.map((width) => (
                    <span key={width} className="flex h-6 items-center">
                        <SkeletonLoader.Shape width={width} />
                    </span>
                ))}
            </span>
        </div>
    );
}

/** The loading description's lines: a full one, a wide one and a shorter last, as a short paragraph runs. */
const lineWidths = ['full', 'wide', 'medium'] as const;
