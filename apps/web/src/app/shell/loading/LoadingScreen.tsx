// The loading screen: the Lar Factory lockup over one line naming the first read's step. It covers the board from the
// page's first paint until board content is available and the mark has drawn, then fades out once. Background
// reads and server restarts keep the loaded board visible.

import {
    boardApp,
    BRAND_BLOCK_COLOR,
    BRAND_MARK_BAR,
    BRAND_MARK_BLOCK,
    BRAND_MARK_CENTRE_LINE,
    BRAND_MARK_L,
    BRAND_MARK_VIEWBOX,
} from '@lar-factory/shared';
import { LoadingScreen as Screen } from '@lar-works/design-system';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { stepText } from './StepText';
import { useBoardStore } from '@/services/board/board.hooks';
import { useInstallStore } from '@/services/install/install.hooks';

/** The draw (lar-apple's LarLogoMark): the block from 0.1 s, the L's trace from 0.42 s, "ar" from 1 s, the product's fade ending at 1.75 s. */
const DRAW_MS = 1750;
const EXIT_MS = 600;
const ROLL_MS = 380;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The desktop's first page already drew the mark, so the board page opens on it finished. */
const drawnByDesktop = () => new URLSearchParams(location.search).get('loading') === 'drawn';

type Phase = 'showing' | 'leaving' | 'gone';

/** The screen's phase and whether the mark is drawn. Readiness stays true after the page's initial read. */
function useScreen(settled: boolean): { phase: Phase; drawn: boolean } {
    const [drawn, setDrawn] = useState(() => drawnByDesktop() || reducedMotion());
    // Whether the screen has finished leaving; it starts once the page is ready and the mark drawn, which both stay so.
    const [left, setLeft] = useState(false);
    const leaving = settled && drawn;
    const phase: Phase = !leaving ? 'showing' : left ? 'gone' : 'leaving';

    useEffect(() => {
        if (drawn) return;

        const timer = setTimeout(() => setDrawn(true), DRAW_MS);

        return () => clearTimeout(timer);
    }, [drawn]);
    useEffect(() => {
        if (!leaving) return;

        const timer = setTimeout(() => setLeft(true), EXIT_MS);

        return () => clearTimeout(timer);
    }, [leaving]);

    return { phase, drawn };
}

interface Line {
    id: number;
    text: string;
}
interface Lines {
    current: Line;
    leaving?: Line;
    rolled: boolean;
}

/**
 * The step line: the current text, and for ROLL_MS after a change the old one rolling out. The first text, and every
 * text with reduced motion, just shows. A text that arrives while a roll is in flight takes the incoming line's place
 * without a roll of its own, so steps that change within a few milliseconds roll once, not once each.
 */
function useLines(text: string): Lines {
    const [lines, setLines] = useState<Lines>({ current: { id: 0, text }, rolled: false });

    // A change of text shows in the same render, so the old line never paints beside the new one.
    if (lines.current.text !== text) {
        if (lines.leaving) {
            setLines({ ...lines, current: { id: lines.current.id, text } });
        } else {
            const roll = !reducedMotion();

            setLines({
                current: { id: lines.current.id + 1, text },
                ...(roll && { leaving: lines.current }),
                rolled: roll,
            });
        }
    }

    const leaving = lines.leaving;

    useEffect(() => {
        if (!leaving) return;

        const timer = setTimeout(() => setLines((now) => ({ ...now, leaving: undefined })), ROLL_MS);

        return () => clearTimeout(timer);
    }, [leaving]);

    return lines;
}

/** The mark, as the design system's LoadingScreen draws it: the block springing in, then the L traced around it along
 *  its centre line; the filled L stands in for the trace once drawn. */
const MARK = {
    viewBox: BRAND_MARK_VIEWBOX,
    block: BRAND_MARK_BLOCK,
    blockColor: BRAND_BLOCK_COLOR,
    centreLine: BRAND_MARK_CENTRE_LINE,
    bar: BRAND_MARK_BAR,
    l: BRAND_MARK_L,
};

/** Keeps the board out of the keyboard's and screen readers' reach while `covered`: the board is the page's root, which the screen sits beside. */
function useInertBoard(covered: boolean) {
    useLayoutEffect(() => {
        const board = document.getElementById('app');

        if (!covered || !board) return;

        board.setAttribute('inert', '');

        return () => board.removeAttribute('inert');
    }, [covered]);
}

export function LoadingScreen() {
    const read = useBoardStore((state) => state.data.firstRead);
    const loaded = useBoardStore((state) => state.loaded);
    const { phase, drawn } = useScreen(loaded);
    const { current, leaving, rolled } = useLines(stepText(read));

    useInertBoard(phase !== 'gone');

    const installs = useInstallStore((state) => state.snapshot?.installs);
    const follow = useInstallStore((state) => state.follow);

    useEffect(follow, [follow]);
    useEffect(() => {
        if (phase === 'gone' && installs)
            void boardApp()
                ?.boardReady()
                .catch(() => {});
    }, [phase, installs]);

    if (phase === 'gone') return null;

    // In the body, beside the board's root, so the board can be inert without the screen.
    return createPortal(
        <Screen
            mark={MARK}
            product="Factory"
            drawn={drawn}
            leaving={phase === 'leaving'}
            line={current}
            {...(leaving && { leavingLine: leaving })}
            rolled={rolled}
        />,
        document.body,
    );
}
