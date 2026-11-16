import type { WorkMapPrerequisite } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';
import { FlaskConicalIcon } from '@lar-works/design-system/icons';
import type { ReactNode } from 'react';


/** A map card's size, the same as a desk card's (items.css's --desk-card-width and --desk-card-height): 18rem by 10.5rem,
 *  whatever the screen or what the card says, so the map's cards and your desk's read as one kind of card. */
export const MAP_NODE_WIDTH = 288;
export const MAP_NODE_HEIGHT = 168;

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
            data-map-card
            className="board-card flex flex-col gap-1 px-3 py-2.5"
            data-card-tone="held"
        >
            <span className="text-fg-muted flex items-center gap-1.5 text-xs">
                <FlaskConicalIcon className="size-3.5" />
                {label}
            </span>
            <span className="line-clamp-2 text-sm leading-5">{title}</span>
            <span className="mt-auto flex min-w-0 items-center gap-1.5 text-xs">
                {glyph}
                <span className="min-w-0 truncate" title={stepsTitle}>
                    {steps}
                </span>
            </span>
        </div>
    );
}

/** A recorded prerequisite outside the group, distinct from one of its parts. */
export function MapPrerequisiteNode({
    prerequisite,
    width,
    height,
}: {
    prerequisite: WorkMapPrerequisite;
    width: number;
    height: number;
}) {
    const { blocker, kind, title, id } = prerequisite;
    const state =
        kind === 'dependency'
            ? blocker.dependency?.met
                ? 'Accepted as met'
                : blocker.dependency?.proofState === 'submitted'
                  ? 'Waiting for acceptance as met'
                  : blocker.dependency?.proofState === 'insufficient'
                    ? 'Proof insufficient · waiting'
                    : 'Waiting for proof'
            : blocker.state === 'closed'
              ? 'Complete'
              : 'Waiting for completion';

    return (
        <div
            data-map-prerequisite={id}
            data-prerequisite-kind={kind}
            className="board-card flex flex-col gap-2 px-3 py-2.5 text-sm"
            data-card-tone="held"
            style={{ width, height }}
            data-map-card
            title={`${title} · ${state}`}
        >
            <Text as="span" variant="caption" tone="muted">
                {kind === 'dependency' ? 'Dependency' : 'Work outside this group'}
            </Text>
            <span className="line-clamp-3 wrap-anywhere">{title}</span>
            <span className="text-fg-muted mt-auto text-xs">{state}</span>
        </div>
    );
}
