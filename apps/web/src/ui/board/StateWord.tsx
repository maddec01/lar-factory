// A state on the board as the status-word rule draws it (docs/Introduction.mdx): the state's light, then its word in
// neutral text. A tinted pill is for a verdict or a category, never a state.

import { StatusIndicator } from '@lar-works/design-system';
import type { StatusState } from '@lar-works/design-system';
import type { ReactNode, Ref } from 'react';

import type { DataAttributes } from './DataAttributes';

/** The state's light and its word, which truncates in a narrow slot (`title` then says it whole). Muted for an `off`
 *  state, as StatusIndicator's word. */
export function StateWord({
    state,
    color,
    title,
    ref,
    tabIndex,
    className = '',
    children,
    ...data
}: {
    /** What the state means, which picks its light. */
    state: StatusState;
    /** A board colour for the light in place of the state's, such as merged work's. */
    color?: string | undefined;
    /** The state in full, as its tooltip. */
    title?: string | undefined;
    /** Lets a caller focus it from script. */
    ref?: Ref<HTMLSpanElement> | undefined;
    tabIndex?: number | undefined;
    /** Places it in a board composition. */
    className?: string;
    /** The state's word, such as "Merged". */
    children: ReactNode;
} & DataAttributes) {
    return (
        <span
            {...data}
            ref={ref}
            tabIndex={tabIndex}
            title={title}
            className={`inline-flex max-w-full min-w-0 items-center gap-1.5 text-xs font-medium ${state === 'off' ? 'text-fg-muted' : 'text-fg'} ${className}`}
        >
            <StatusIndicator size="sm" state={state} labelColor={color} />
            <span className="min-w-0 truncate">{children}</span>
        </span>
    );
}
