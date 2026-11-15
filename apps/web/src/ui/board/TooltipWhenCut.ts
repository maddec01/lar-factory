import type { SyntheticEvent } from 'react';

/** An event handler, for the pointer's or the focus's arrival, that names `full` as the element's tooltip only while
 *  its label (by default its last child) is cut off, at its end or, clamped to some lines, at its last: text shown whole needs no tooltip, which would only float a copy
 *  of it beside the text. */
export const tooltipWhenCut =
    (full: string, labelOf: (element: HTMLElement) => Element | null = (element) => element.lastElementChild) =>
    (event: SyntheticEvent<HTMLElement>) => {
        const element = event.currentTarget;
        const label = labelOf(element);

        // A pixel of slack, as a line's descenders can reach just past a one-line box.
        if (label && (label.scrollWidth > label.clientWidth || label.scrollHeight > label.clientHeight + 1))
            element.title = full;
        else element.removeAttribute('title');
    };
