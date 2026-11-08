import { FlaskConicalIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';

const NODE_ATTENTION = {
    default: 'border-line',
    asks: 'border-warning-edge shadow-[inset_3px_0_0_var(--color-warning)]',
    waits: 'border-dashed border-line-strong',
} as const;

/**
 * A part on the map, `width` by `height`: a card that opens it (`openLabel` names the button, `title` says it all),
 * with its `source` in the corner, a `head` line (kind, repository, fields) with its `action` at the right, its title,
 * its `glyph` and `facts`, and its `slices` along the bottom. It `asks` (an answer from you) or `waits` (on other work)
 * in its border, and is ringed while `picked`.
 */
export function MapPartNode({
    id,
    width,
    height,
    attention = 'default',
    picked,
    openLabel,
    title,
    onOpen,
    source,
    head,
    action,
    name,
    glyph,
    facts,
    slices,
}: {
    /** The part's item, named as `data-item`. */
    id: string;
    /** The card's width in pixels. */
    width: number;
    /** The card's height in pixels. */
    height: number;
    /** What the part needs: `asks` an answer from you, `waits` on other work, or `default` neither. */
    attention?: keyof typeof NODE_ATTENTION;
    /** The item the dialog shows now. */
    picked: boolean;
    /** The card button's accessible name. */
    openLabel: string;
    /** The part in full, as its tooltip. */
    title: string;
    /** Called as the reader opens the part. */
    onOpen: () => void;
    /** Where its ticket is saved, in the corner. */
    source: ReactNode;
    /** The card's head line, such as its repository. */
    head: ReactNode;
    /** What it asks next. */
    action?: ReactNode;
    /** The part's name. */
    name: ReactNode;
    /** The part's status glyph. */
    glyph: ReactNode;
    /** Its facts on one line. */
    facts: string;
    /** Its slices, a SliceBar. */
    slices?: ReactNode;
}) {
    return (
        <div
            style={{ width, height }}
            data-map-part={id}
            className={`bg-surface-raised relative flex flex-col gap-1 overflow-hidden rounded-lg border px-2.5 py-2 text-left shadow-(--shadow-raised) ${NODE_ATTENTION[attention]} ${picked ? 'ring-primary ring-offset-surface-raised ring-2 ring-offset-1' : ''}`}
        >
            <button
                type="button"
                aria-label={openLabel}
                title={title}
                onClick={onOpen}
                className="focus-ring hover:bg-fill-hover/60 absolute inset-0 rounded-lg"
            />
            {source}
            <span
                className="text-2xs text-fg-muted pointer-events-none relative flex min-h-6 min-w-0 items-center gap-1.5 pr-5"
                data-map-head
            >
                {head}
                {action && <span className="pointer-events-auto ml-auto shrink-0">{action}</span>}
            </span>
            <span className="text-ui pointer-events-none relative line-clamp-2 leading-snug font-medium">{name}</span>
            <span
                className={`pointer-events-none relative mt-auto flex min-w-0 items-center gap-1.5 text-xs ${slices ? 'mb-3' : ''}`}
            >
                {glyph}
                <span className="min-w-0 flex-1 truncate" data-map-facts>
                    {facts}
                </span>
            </span>
            {slices && <span className="pointer-events-none absolute inset-x-2.5 bottom-2">{slices}</span>}
        </div>
    );
}

/** The end-to-end check at the end of the map, `width` by `height`: its `label`, title, then its `glyph` and `steps`
 *  (how many, and what it comes after), which `stepsTitle` says in full. */
export function MapCheckNode({
    width,
    height,
    label,
    title,
    glyph,
    steps,
    stepsTitle,
}: {
    /** The card's width in pixels. */
    width: number;
    /** The card's height in pixels. */
    height: number;
    /** The check's label, such as "End to end". */
    label: string;
    /** The check's title. */
    title: string;
    /** The check's status glyph. */
    glyph: ReactNode;
    /** How many steps, and what it comes after. */
    steps: string;
    /** The steps in full, as their tooltip. */
    stepsTitle?: string | undefined;
}) {
    return (
        <div
            style={{ width, height }}
            data-map-check
            className="border-line-strong bg-surface-raised flex flex-col gap-1 rounded-lg border-2 border-dashed px-2.5 py-2 shadow-(--shadow-raised)"
        >
            <span className="text-2xs text-fg-muted flex items-center gap-1.5">
                <FlaskConicalIcon className="size-3.5" />
                {label}
            </span>
            <span className="text-ui line-clamp-2 leading-snug font-medium">{title}</span>
            <span className="mt-auto flex min-w-0 items-center gap-1.5 text-xs">
                {glyph}
                <span className="min-w-0 truncate" title={stepsTitle}>
                    {steps}
                </span>
            </span>
        </div>
    );
}
