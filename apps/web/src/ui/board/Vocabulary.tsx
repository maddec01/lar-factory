// A project's kind vocabulary in Lar Factory's settings and onboarding: each kind's row, with its type and the chips of
// its labels, and the chooser that picks them from the tracker's labels.

import type { ReactNode } from 'react';

import type { DataAttributes } from './DataAttributes';

/**
 * One kind's row: its `title`, its `type` control, then its labels' chips in a group `labelsLabel` names, which take a
 * line of their own on a narrow page, ending with the `chooser` that edits them; what the row says about them (notes,
 * problems, actions) follows under it.
 */
export function VocabularyRow({
    title,
    type,
    labels,
    labelsLabel,
    chooser,
    children,
    ...data
}: {
    /** The kind's name. */
    title: string;
    /** The kind's type control. */
    type: ReactNode;
    /** The labels' chips. */
    labels: ReactNode;
    /** Names the labels' group. */
    labelsLabel: string;
    /** The control that adds a label. */
    chooser: ReactNode;
    /** What the row says under it, such as a suggestion. */
    children?: ReactNode;
} & DataAttributes) {
    return (
        <div {...data} className="grid min-w-0 gap-2 px-3 py-3">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-x-3 gap-y-2 sm:grid-cols-[5.5rem_8.5rem_minmax(0,1fr)]">
                <span className="text-ui font-medium">{title}</span>
                {type}
                <div
                    role="group"
                    aria-label={labelsLabel}
                    className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 sm:col-span-1"
                >
                    {labels}
                    <span className="ms-auto flex">{chooser}</span>
                </div>
            </div>
            {children}
        </div>
    );
}

/** The chip that stands for the labels past the first few, which opens the chooser (`label` names it). */
export function VocabularyMore({
    label,
    onClick,
    children,
}: {
    /** The chip's accessible name, which opens the chooser. */
    label: string;
    /** Called as the reader opens the chooser. */
    onClick: () => void;
    /** How many more labels, such as "+3". */
    children: string;
}) {
    return (
        <button
            type="button"
            className="bg-surface-sunken cursor-pointer rounded-full px-2 text-xs"
            aria-label={label}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

/** A suggested label, dashed, which a press maps. */
export function VocabularySuggestion({
    disabled = false,
    onClick,
    children,
}: {
    /** Can't be mapped now. */
    disabled?: boolean;
    /** Called as the reader maps the label. */
    onClick: () => void;
    /** The suggested label. */
    children: ReactNode;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="border-line cursor-pointer rounded-full border border-dashed px-2 py-0.5 text-xs"
            onClick={onClick}
        >
            {children}
        </button>
    );
}
