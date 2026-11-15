// The board's one "+N": what a short list leaves out, after the ones it shows.

import { Tooltip, TooltipPopup, TooltipTrigger } from '@lar-works/design-system';

/** "+N" after the first few of a list (labels, a limit's bars): muted 12px figures. `names` lists what it stands for
 *  on hover, one a line, and `label` says it to screen readers; with `onOpen` it is a button that opens the whole
 *  list. */
export function OverflowCount({
    n,
    names,
    label,
    onOpen,
}: {
    /** How many are left out. */
    n: number;
    /** What is left out, named on hover; none where the list around it already names them. */
    names?: readonly string[] | undefined;
    /** What it stands for, in words, such as "3 more labels". */
    label?: string | undefined;
    /** Opens the whole list. */
    onOpen?: (() => void) | undefined;
}) {
    const figure = `+${n}`;
    const look = 'text-fg-muted shrink-0 rounded-xs text-xs font-normal tabular-nums';
    const shown = onOpen ? (
        <button
            type="button"
            className={`${look} hover:text-fg focus-ring cursor-pointer transition-colors`}
            aria-label={label}
            onClick={onOpen}
            data-overflow-count
        >
            {figure}
        </button>
    ) : (
        <span className={look} data-overflow-count>
            {label ? (
                <>
                    <span aria-hidden="true">{figure}</span>
                    <span className="sr-only">{label}</span>
                </>
            ) : (
                figure
            )}
        </span>
    );

    if (!names?.length) return shown;

    return (
        <Tooltip>
            <TooltipTrigger asChild>{shown}</TooltipTrigger>
            <TooltipPopup side="bottom">
                <span className="whitespace-pre-line">{names.join('\n')}</span>
            </TooltipPopup>
        </Tooltip>
    );
}
