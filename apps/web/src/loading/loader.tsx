// What the board shows in place of something still loading after the splash: a small spinner, still under reduced motion,
// and what loads.

import { LoaderCircle } from 'lucide-react';

/** The spinner and `label`; with no label, the spinner alone, named by `title` for a cue beside values already shown. */
export function Loader({ label, title, className = 'size-3' }: { label?: string; title?: string; className?: string }) {
  return (
    <span data-loader className="inline-flex min-w-0 items-center gap-1.5" title={title}>
      <LoaderCircle aria-hidden="true" className={`${className} shrink-0 motion-safe:animate-spin`} />
      {label ? <span className="truncate">{label}</span> : title && <span className="sr-only">{title}</span>}
    </span>
  );
}
