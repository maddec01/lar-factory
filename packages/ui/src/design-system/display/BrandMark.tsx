// The lar mark on a 100-unit box: the L takes the ink colour, the block is always lar blue.
const MARK_L =
    'M0 13.76a13.76 13.76 0 0 1 27.52 0V72.48H86.24a13.76 13.76 0 0 1 0 27.52H13.76a13.76 13.76 0 0 1-13.76-13.76z';
const MARK_S =
    'M54.12 0H88.53a11.47 11.47 0 0 1 11.47 11.47V45.88a11.47 11.47 0 0 1-11.47 11.47H54.12a11.47 11.47 0 0 1-11.47-11.47V11.47a11.47 11.47 0 0 1 11.47-11.47z';

/** The lar lockup: the mark, flush with the top of the l and on the baseline, then the name. */
export function BrandMark({ label }: { label: string }) {
    return (
        <span
            role="img"
            aria-label={label}
            className="lar-brand-mark inline-flex shrink-0 items-baseline text-xl leading-none"
        >
            <svg aria-hidden viewBox="0 0 100 100" className="mr-[0.266em] size-[0.705em] shrink-0">
                <path d={MARK_L} fill="currentColor" />
                <path d={MARK_S} fill="#355292" />
            </svg>
            <span aria-hidden className="font-bold tracking-[-0.03em]">
                lar
            </span>
        </span>
    );
}
