// The loading screen: the Lar Factory lockup over one line naming the first read's step. It covers the board from the
// page's first paint until the first read has settled, or a repository's items have landed, and the mark has drawn,
// then fades out. It comes back whenever the server's first read is unsettled again with nothing read, after a restart.

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BRAND_BLOCK_COLOR, BRAND_MARK_BAR, BRAND_MARK_BLOCK, BRAND_MARK_CENTRE_LINE, BRAND_MARK_L, BRAND_MARK_VIEWBOX } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { stepText } from './step-text.ts';

/** The draw (lar-apple's LarLogoMark): the block from 0.1 s, the L's trace from 0.42 s, "ar" from 1 s, the product's fade ending at 1.75 s. */
const DRAW_MS = 1750;
const EXIT_MS = 600;
const ROLL_MS = 380;

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The desktop's first page already drew the mark, so the board page opens on it finished. */
const drawnByDesktop = () => new URLSearchParams(location.search).get('loading') === 'drawn';

type Phase = 'showing' | 'leaving' | 'gone';

/** The screen's phase and whether the mark is drawn. The screen leaves once the read is settled and the mark drawn; an unsettled read brings it back. */
function useScreen(settled: boolean): { phase: Phase; drawn: boolean } {
  const [drawn, setDrawn] = useState(() => drawnByDesktop() || reducedMotion());
  const [phase, setPhase] = useState<Phase>('showing');
  useEffect(() => {
    if (drawn) return;
    const timer = setTimeout(() => setDrawn(true), DRAW_MS);
    return () => clearTimeout(timer);
  }, [drawn]);
  useEffect(() => {
    if (!settled) return setPhase('showing');
    if (!drawn) return;
    setPhase('leaving');
    const timer = setTimeout(() => setPhase('gone'), EXIT_MS);
    return () => clearTimeout(timer);
  }, [settled, drawn]);
  return { phase, drawn };
}

interface Line { id: number; text: string }
interface Lines { current: Line; leaving?: Line; rolled: boolean }

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
      setLines({ current: { id: lines.current.id + 1, text }, ...roll && { leaving: lines.current }, rolled: roll });
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

/** The mark: the block springing in, then the L traced around it along its centre line; the filled L stands in for the trace once drawn. */
function Mark() {
  return (
    <svg className="loading-mark" viewBox={BRAND_MARK_VIEWBOX} aria-hidden>
      <path className="loading-mark-block" d={BRAND_MARK_BLOCK} fill={BRAND_BLOCK_COLOR} />
      <path className="loading-mark-trace" d={BRAND_MARK_CENTRE_LINE} pathLength={1} fill="none" stroke="currentColor" strokeWidth={BRAND_MARK_BAR} strokeLinecap="butt" strokeLinejoin="miter" />
      <path className="loading-mark-fill" d={BRAND_MARK_L} fill="currentColor" />
    </svg>
  );
}

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
  // The board fills in as each repository's read lands, so the first to land ends the screen.
  const landed = useBoardStore((state) => state.data.firstRead.waiting !== undefined);
  const { phase, drawn } = useScreen(read.settled || landed);
  const { current, leaving, rolled } = useLines(stepText(read));
  useInertBoard(phase !== 'gone');
  if (phase === 'gone') return null;
  // In the body, beside the board's root, so the board can be inert without the screen.
  return createPortal(
    <div className={`loading-screen ${drawn ? 'is-drawn' : ''} ${phase === 'leaving' ? 'is-leaving' : ''}`}>
      <div className="loading-lockup">
        <div className="loading-wordmark">
          <Mark />
          <span className="loading-lar"><span className="loading-lar-slide">ar</span></span>
          <span className="loading-factory">Factory</span>
        </div>
        <p className="loading-line" role="status">
          <span className="loading-line-slot">
            {leaving && <span key={leaving.id} className="loading-roll-out" aria-hidden>{leaving.text}</span>}
            <span key={current.id} className={rolled ? 'loading-roll-in' : undefined}>{current.text}</span>
          </span>
        </p>
      </div>
    </div>,
    document.body,
  );
}
