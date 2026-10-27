// PROTOTYPE (#476 round 2, throwaway, never merged): round 1's variant A, the centred lockup, now "lar factory", in
// three variants on /prototype-loading-screen.html that differ only in how the step line changes: ?variant=A1|A2|A3
// and the floating bar. Two more toggles, independent of the variant: ?line=center|left places the step line, and
// ?exit=fade|dock|blur picks how the screen leaves for the board. The steps are faked; the board behind is painted
// from packages/shared's sample data with no server.
//
// Every variant shares the draw (the L traced along its centre line over 0.9 s, then the block springs in), the
// breathing while loading continues, and the lockup: laid out as the sidebar's Brand is, so the dock exit lands on it.

import '../index.css';
import './loading-screen-prototype.css';
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BRAND_BLOCK_COLOR, BRAND_MARK_BLOCK, BRAND_MARK_L, BRAND_MARK_VIEWBOX } from '@lar-factory/shared';
import sample from '../../../../packages/shared/test/sample.json';

// The board reads its data from the page at import, so put the sample there before importing it.
document.getElementById('board-data')!.textContent = JSON.stringify({ ...sample, fetchedAt: new Date().toISOString() });
const { App } = await import('../app.tsx');

// --- The fake load -------------------------------------------------------------------------------------------

type Speed = 'fresh' | 'warm';
type Step = { text: string; ms: Record<Speed, number> };

const STEPS: Step[] = [
  { text: 'Reading your shell PATH', ms: { fresh: 1200, warm: 200 } },
  { text: 'Starting the board server', ms: { fresh: 2000, warm: 300 } },
  { text: 'Checking gh and tools', ms: { fresh: 2200, warm: 300 } },
  { text: 'Reading lar-apple', ms: { fresh: 1400, warm: 250 } },
  { text: 'Reading lar-server', ms: { fresh: 4000, warm: 250 } }, // the slow repository read
  { text: 'Reading pull requests', ms: { fresh: 1200, warm: 200 } },
];
const ERROR_LINE = "The board server didn't start: port 4317 is in use. Trying again.";
const ERROR_MS = 2600;

/** What the line says now; `id` changes with each new line, so the variants can animate the change. */
type Line = { id: number; text: string; error: boolean };

/** Plays the steps, with one failed server start when `error` is on, then calls `done`. */
function useFakeLoad(run: number, speed: Speed, error: boolean, done: () => void): Line {
  const [line, setLine] = useState<Line>({ id: 0, text: STEPS[0]!.text, error: false });
  useEffect(() => {
    const script: { text: string; error: boolean; ms: number }[] = [];
    for (const [i, step] of STEPS.entries()) {
      if (i === 1 && error) {
        script.push({ text: step.text, error: false, ms: step.ms[speed] });
        script.push({ text: ERROR_LINE, error: true, ms: ERROR_MS });
      }
      script.push({ text: step.text, error: false, ms: step.ms[speed] });
    }
    const timers: number[] = [];
    let at = 0;
    script.forEach((s, i) => {
      timers.push(window.setTimeout(() => setLine({ id: run * 100 + i, text: s.text, error: s.error }), at));
      at += s.ms;
    });
    timers.push(window.setTimeout(done, at));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, speed, error]);
  return line;
}

// --- The shared mark -----------------------------------------------------------------------------------------

/** The L's centre line, from lar-apple's LarLogoShape: a 27.52 bar stroked with round caps and joins from the
 *  top of the stem to the end of the foot covers exactly the brand outline. */
const BAR = 27.52;
const CENTRE_LINE = `M${BAR / 2} ${BAR / 2}V${100 - BAR / 2}H${100 - BAR / 2}`;
const DRAW_MS = 150 + 900; // LarLogoMark's delay and trace
const SETTLE_MS = 800 + 500; // the block's spring delay and duration
const EXIT_MS = 600;

/** The mark: drawn in, then breathing until the screen leaves (loading-screen-prototype.css). */
function Mark() {
  return (
    <svg className="proto-mark" viewBox={BRAND_MARK_VIEWBOX} aria-hidden>
      <g className="proto-mark-breath">
        <path className="proto-mark-block" d={BRAND_MARK_BLOCK} fill={BRAND_BLOCK_COLOR} />
        <path className="proto-mark-trace" d={CENTRE_LINE} pathLength={1} fill="none" stroke="currentColor" strokeWidth={BAR} strokeLinecap="round" strokeLinejoin="round" />
        <path className="proto-mark-fill" d={BRAND_MARK_L} fill="currentColor" />
      </g>
    </svg>
  );
}

/** Keeps the previous line around for one transition, so a variant can animate it out as the new one comes in. */
function useLines(line: Line, keepMs: number): { line: Line; leaving: boolean }[] {
  const [lines, setLines] = useState([line]);
  useEffect(() => {
    setLines((prev) => (prev.at(-1)!.id === line.id ? prev : [prev.at(-1)!, line]));
    const t = window.setTimeout(() => setLines([line]), keepMs);
    return () => clearTimeout(t);
  }, [line, keepMs]);
  return lines.map((l, i) => ({ line: l, leaving: i < lines.length - 1 }));
}

// --- The step line's three transitions ------------------------------------------------------------------------

/** A1: the old line rolls up and out with a slight blur, the new one rolls in from below. */
function RollLine({ line }: { line: Line }) {
  return (
    <>
      {useLines(line, 420).map(({ line: l, leaving }) => (
        <span key={l.id} className={`${l.error ? 'proto-error' : ''} ${leaving ? 'proto-roll-out' : 'proto-roll-in'}`}>{l.text}</span>
      ))}
    </>
  );
}

/** A2: the new line types in at 25 ms a character while the old one clears. Every character is laid out from the
 *  start, so a centred line doesn't drift as it grows. */
function TypeLine({ line }: { line: Line }) {
  return (
    <>
      {useLines(line, 160).map(({ line: l, leaving }) => (
        <span key={l.id} className={`${l.error ? 'proto-error' : ''} ${leaving ? 'proto-clear' : ''}`}>
          {leaving ? l.text : [...l.text].map((c, i) => <span key={i} className="proto-type" style={{ animationDelay: `${i * 25}ms` }}>{c}</span>)}
        </span>
      ))}
    </>
  );
}

/** A3: the line swaps at once, and a soft highlight sweeps across it while its step runs. */
function ShimmerLine({ line }: { line: Line }) {
  return <span key={line.id} className={line.error ? 'proto-error' : 'proto-shimmer'}>{line.text}</span>;
}

const VARIANTS = {
  A1: { name: 'Roll', Line: RollLine },
  A2: { name: 'Type', Line: TypeLine },
  A3: { name: 'Shimmer', Line: ShimmerLine },
} as const;
type VariantKey = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as VariantKey[];

type Align = 'center' | 'left';
type Exit = 'fade' | 'dock' | 'blur';
const ALIGNS: Record<Align, string> = { center: 'Line centred', left: 'Line under "lar"' };
const EXITS: Record<Exit, string> = { fade: 'Fade', dock: 'Dock to sidebar', blur: 'Blur, board scales' };

// --- The screen and the bar -------------------------------------------------------------------------------------

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The lockup's move onto the sidebar's Brand: the translation and scale that lay this mark over the sidebar's mark,
 *  or nothing when the sidebar's brand isn't on screen (a narrow window), where the dock falls back to the fade. */
function dockTransform(mark: Element | null): string | undefined {
  const target = document.querySelector('.brand svg')?.getBoundingClientRect();
  const from = mark?.getBoundingClientRect();
  if (!target || !from || !target.width || !from.width) return undefined;
  return `translate(${target.left - from.left}px, ${target.top - from.top}px) scale(${target.width / from.width})`;
}

/** The loading screen over the board: it leaves once the load is done and the mark has finished drawing. */
function LoadingScreen(props: { variant: VariantKey; align: Align; exit: Exit; run: number; speed: Speed; error: boolean; onLeave: () => void; onGone: () => void }) {
  const { variant, align, run, speed, error, onLeave, onGone } = props;
  const [loaded, setLoaded] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [dock, setDock] = useState<string>();
  const lockup = useRef<HTMLDivElement>(null);
  const line = useFakeLoad(run, speed, error, useCallback(() => setLoaded(true), []));
  useEffect(() => {
    const t = window.setTimeout(() => setDrawn(true), reducedMotion() ? 0 : Math.max(DRAW_MS, SETTLE_MS));
    return () => clearTimeout(t);
  }, []);
  const leaving = loaded && drawn;
  const exit = reducedMotion() ? 'fade' : props.exit;
  useEffect(() => {
    if (!leaving) return;
    if (exit === 'dock') setDock(dockTransform(lockup.current?.querySelector('.proto-mark') ?? null));
    onLeave();
    const t = window.setTimeout(onGone, EXIT_MS);
    return () => clearTimeout(t);
  }, [leaving, exit, onLeave, onGone]);
  const { Line: StepLine } = VARIANTS[variant];
  const exitClass = !leaving ? '' : exit === 'dock' && !dock ? 'exit-fade' : `exit-${exit}`;
  return (
    <div className={`proto-screen ${drawn ? 'is-drawn' : ''} ${exitClass}`} role="status">
      <div className="proto-backdrop" />
      <div className={`proto-lockup line-${align}`}>
        <div className="proto-wordmark" ref={lockup} style={dock ? { transform: dock } : undefined}>
          <Mark />
          <span className="proto-lar">lar</span>
          <span className="proto-factory">factory</span>
        </div>
        <p className="proto-line" aria-live="polite">
          <span className="proto-line-slot"><StepLine line={line} /></span>
        </p>
      </div>
    </div>
  );
}

function Segmented<T extends string>({ options, value, set }: { options: Record<T, string>; value: T; set: (v: T) => void }) {
  return (
    <>
      {(Object.keys(options) as T[]).map((k) => (
        <button key={k} className={value === k ? 'is-on' : ''} onClick={() => set(k)}>{options[k]}</button>
      ))}
    </>
  );
}

type BarProps = {
  variant: VariantKey; setVariant: (v: VariantKey) => void;
  align: Align; setAlign: (a: Align) => void;
  exit: Exit; setExit: (e: Exit) => void;
  speed: Speed; setSpeed: (s: Speed) => void;
  replay: (error?: boolean) => void; theme: string; toggleTheme: () => void; phase: string;
};

function Bar(props: BarProps) {
  const { variant, setVariant } = props;
  const step = (d: number) => setVariant(KEYS[(KEYS.indexOf(variant) + d + KEYS.length) % KEYS.length]!);
  return (
    <div className="proto-bar">
      <div className="proto-bar-row">
        <button onClick={() => step(-1)} aria-label="Previous variant">‹</button>
        <span className="proto-bar-label">{variant} · {VARIANTS[variant].name}</span>
        <button onClick={() => step(1)} aria-label="Next variant">›</button>
        <span className="proto-bar-sep" />
        <Segmented options={ALIGNS} value={props.align} set={props.setAlign} />
        <span className="proto-bar-sep" />
        <Segmented options={EXITS} value={props.exit} set={props.setExit} />
      </div>
      <div className="proto-bar-row">
        <button onClick={() => props.replay()}>Replay</button>
        <Segmented options={{ fresh: 'Fresh install', warm: 'Warm start' }} value={props.speed} set={props.setSpeed} />
        <button onClick={() => props.replay(true)}>Show error</button>
        <button onClick={props.toggleTheme}>{props.theme === 'dark' ? 'Light' : 'Dark'}</button>
        <span className="proto-bar-state">{props.phase}</span>
      </div>
    </div>
  );
}

function pick<T extends string>(value: string | null, keys: readonly T[], fallback: T): T {
  return keys.includes(value as T) ? (value as T) : fallback;
}

function Prototype() {
  const params = new URLSearchParams(location.search);
  const [variant, setVariantState] = useState(pick(params.get('variant')?.toUpperCase() ?? null, KEYS, 'A1'));
  const [align, setAlignState] = useState(pick(params.get('line'), ['center', 'left'] as const, 'center'));
  const [exit, setExitState] = useState(pick(params.get('exit'), ['fade', 'dock', 'blur'] as const, 'fade'));
  const [speed, setSpeedState] = useState<Speed>(params.get('speed') === 'warm' ? 'warm' : 'fresh');
  const [run, setRun] = useState(1);
  const [error, setError] = useState(false);
  const [showing, setShowing] = useState(true);
  const [boardIn, setBoardIn] = useState(false);
  const [theme, setTheme] = useState(() => params.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => void (document.documentElement.dataset.protoTheme = theme), [theme]);

  const replay = useCallback((withError = false) => {
    setError(withError);
    setRun((r) => r + 1);
    setShowing(true);
    setBoardIn(false);
  }, []);
  const setParam = (key: string, value: string) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  };
  const setter = <T extends string>(key: string, set: Dispatch<SetStateAction<T>>) => (v: T) => {
    set(v);
    setParam(key, v);
    replay();
  };
  const setVariant = setter('variant', setVariantState);
  const setAlign = setter('line', setAlignState);
  const setExit = setter('exit', setExitState);
  const setSpeed = setter('speed', setSpeedState);
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setParam('theme', next);
  };
  const variantRef = useRef(variant);
  variantRef.current = variant;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable]')) return;
      const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      if (d) setVariant(KEYS[(KEYS.indexOf(variantRef.current) + d + KEYS.length) % KEYS.length]!);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLeave = useCallback(() => setBoardIn(true), []);
  const onGone = useCallback(() => setShowing(false), []);
  // The blur exit scales the board up from 0.98 as the screen leaves; the class goes once the screen is gone, so the
  // board's fixed elements aren't left inside a transformed box.
  const scaling = exit === 'blur' && boardIn && showing && !reducedMotion();
  return (
    <>
      <div className={`proto-board ${scaling ? 'is-scaling' : ''}`}><App /></div>
      {showing && <LoadingScreen key={`${run}-${variant}-${align}-${exit}`} variant={variant} align={align} exit={exit} run={run} speed={speed} error={error} onLeave={onLeave} onGone={onGone} />}
      <Bar variant={variant} setVariant={setVariant} align={align} setAlign={setAlign} exit={exit} setExit={setExit} speed={speed} setSpeed={setSpeed} replay={replay} theme={theme} toggleTheme={toggleTheme} phase={showing ? `loading (${speed}${error ? ', error' : ''})` : 'board'} />
    </>
  );
}

createRoot(document.getElementById('app')!).render(<Prototype />);
