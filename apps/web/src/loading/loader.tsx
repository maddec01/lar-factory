// What the board shows in place of something still loading after the splash: a small spinner, still under reduced motion,
// and what loads.

import { LoaderCircle, type LucideProps } from '@lar-works/design-system/icons';

import { ambientMotion } from '../motion/ambient-motion.ts';

/**
 * The loader icon, with `spin`, its animation's class, on a box around it: above a device scale of 1 Chromium can't run
 * a root svg's transform on the compositor, so the page would render every frame.
 */
export const Spinner = ({ spin, ...icon }: LucideProps & { spin: string }) => (
    <span ref={spin ? ambientMotion : undefined} className={`flex w-fit shrink-0 ${spin}`}>
        <LoaderCircle {...icon} />
    </span>
);

/** The spinner and `label`; with no label, the spinner alone, named by `title` for a cue beside values already shown. `still` stops it spinning. */
export function Loader({
    label,
    title,
    className = 'size-3',
    still = false,
}: {
    label?: string;
    title?: string;
    className?: string;
    still?: boolean;
}) {
    return (
        <span data-loader className="inline-flex min-w-0 items-center gap-1.5" title={title}>
            <Spinner spin={still ? '' : 'motion-safe:animate-spin'} aria-hidden="true" className={className} />
            {label ? <span className="truncate">{label}</span> : title && <span className="sr-only">{title}</span>}
        </span>
    );
}
