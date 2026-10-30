// The lar mark on a 100-unit box: the L takes the ink colour, the block is always lar blue.
const MARK_L = 'M0 0H27.52V72.48H100V100H3a3 3 0 0 1-3-3z';
const MARK_S =
    'M50.68 0H91.97a8.03 8.03 0 0 1 8.03 8.03V49.32a8.03 8.03 0 0 1-8.03 8.03H50.68a8.03 8.03 0 0 1-8.03-8.03V8.03a8.03 8.03 0 0 1 8.03-8.03z';

/** The Lar lockup: the mark stands in for the L, on the baseline, then "ar". */
export function BrandMark({ label }: { label: string }) {
    return (
        <span
            role="img"
            aria-label={label}
            className="lar-brand-mark inline-flex shrink-0 items-baseline text-xl leading-none"
        >
            <svg aria-hidden viewBox="0 0 100 100" className="mr-[0.07em] size-[0.705em] shrink-0">
                <path d={MARK_L} fill="currentColor" />
                <path d={MARK_S} fill="#355292" />
            </svg>
            <span aria-hidden className="font-bold tracking-[-0.03em]">
                ar
            </span>
        </span>
    );
}
