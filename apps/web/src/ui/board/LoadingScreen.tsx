import { type SplashLine, type SplashMark, SplashView } from '@lar-works/design-system/primitives';

/** The Lar mark's paths on its viewBox, drawn in the order the screen animates them. */
type LoadingMark = SplashMark;

/** A line of the screen's step text; a new `id` rolls it in. */
type LoadingLine = SplashLine;

interface LoadingScreenProps {
    /** The Lar mark's shape and its drawing. */
    mark: LoadingMark;
    /** The product's name after the lockup's "ar", such as "Factory". */
    product: string;
    /** Whether the mark is already drawn, as by the desktop's starting page; otherwise it plays its draw. */
    drawn: boolean;
    /** Fades the screen out, once. */
    leaving: boolean;
    /** The step line, and for a moment after a change the old one rolling out. */
    line: LoadingLine;
    /** The line on its way out as the next step's comes in. */
    leavingLine?: LoadingLine;
    /** Whether the line rolled in; the first line and every line under reduced motion just show. */
    rolled: boolean;
    /** The calm progress track: `indeterminate` (the default) while how far is unknown, or a fraction from 0 to 1. */
    progress?: number | 'indeterminate';
}

/**
 * The board's loading screen: the shared AppSplash (the same status-line rule and indeterminate track), with the line
 * driven by the board, which times each step of its
 * first read and the desktop's hand-off itself. A board with nothing to time can render AppSplash directly.
 */
export function LoadingScreen(props: LoadingScreenProps) {
    // The board runs in the desktop app's frameless window, under its title bar.
    return <SplashView {...props} chrome="desktop" />;
}
