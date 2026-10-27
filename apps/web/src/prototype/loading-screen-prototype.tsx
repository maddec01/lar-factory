// PROTOTYPE (#476, throwaway, never merged): three variants of the board app's loading screen on
// /prototype-loading-screen.html, switchable by ?variant=A|B|C and the floating bar. The steps are faked; at the end
// the screen fades into the real board, painted from packages/shared's sample data with no server.
//
// All variants share the draw (the L traced along its centre line over 0.9 s, then the block springs in), the
// breathing while loading continues, and the fade. They differ in how the mark and the step line compose.

import '../index.css';
import './loading-screen-prototype.css';
import { useCallback, useEffect, useRef, useState } from 'react';
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
const FADE_MS = 600;

/** The mark: drawn in, then breathing until the screen leaves (loading-screen-prototype.css). */
function Mark({ size }: { size: number }) {
  return (
    <svg className="proto-mark" viewBox={BRAND_MARK_VIEWBOX} width={size} height={size} aria-hidden>
      <g className="proto-mark-breath">
        <path className="proto-mark-block" d={BRAND_MARK_BLOCK} fill={BRAND_BLOCK_COLOR} />
        <path className="proto-mark-trace" d={CENTRE_LINE} pathLength={1} fill="none" stroke="currentColor" strokeWidth={BAR} strokeLinecap="round" strokeLinejoin="round" />
        <path className="proto-mark-fill" d={BRAND_MARK_L} fill="currentColor" />
      </g>
    </svg>
  );
}

/** Keeps the previous line around for one transition, so a variant can animate it out as the new one comes in. */
function useLines(line: Line): { line: Line; leaving: boolean }[] {
  const [lines, setLines] = useState([line]);
  useEffect(() => {
    setLines((prev) => (prev.at(-1)!.id === line.id ? prev : [prev.at(-1)!, line]));
    const t = window.setTimeout(() => setLines([line]), 500);
    return () => clearTimeout(t);
  }, [line]);
  return lines.map((l, i) => ({ line: l, leaving: i < lines.length - 1 }));
}

// --- The variants ---------------------------------------------------------------------------------------------

/** A: faithful to lar-apple's LarLaunchSplash: the lockup centred, the step line small and muted, cross-fading. */
function VariantA({ line }: { line: Line }) {
  const lines = useLines(line);
  return (
    <div className="proto-a">
      <div className="proto-a-lockup">
        <Mark size={60} />
        <span className="proto-a-name">lar</span>
      </div>
      <p className="proto-a-line" aria-live="polite">
        {lines.map(({ line: l, leaving }) => (
          <span key={l.id} className={`${l.error ? 'proto-error' : ''} ${leaving ? 'proto-fade-out' : 'proto-fade-in'}`}>
            {l.text}
          </span>
        ))}
      </p>
    </div>
  );
}

/** B: a larger mark; each step slides up over the last, with an indeterminate hairline under it. */
function VariantB({ line }: { line: Line }) {
  const lines = useLines(line);
  return (
    <div className="proto-b">
      <Mark size={128} />
      <div className="proto-b-stack">
        <p className="proto-b-line" aria-live="polite">
          {lines.map(({ line: l, leaving }) => (
            <span key={l.id} className={`${l.error ? 'proto-error' : ''} ${leaving ? 'proto-slide-out' : 'proto-slide-in'}`}>
              {l.text}
            </span>
          ))}
        </p>
        <div className={`proto-b-hairline ${line.error ? 'is-error' : ''}`} />
      </div>
    </div>
  );
}

/** C: a small mark over one left-aligned terminal line with a running ellipsis: closer to a tool than a splash. */
function VariantC({ line }: { line: Line }) {
  return (
    <div className="proto-c">
      <Mark size={36} />
      <p className={`proto-c-line ${line.error ? 'proto-error' : ''}`} aria-live="polite" key={line.id}>
        <span className="proto-c-prompt">{line.error ? '✕' : '›'}</span>
        {line.error ? line.text : <>{line.text}<span className="proto-c-dots">...</span></>}
      </p>
    </div>
  );
}

const VARIANTS = {
  A: { name: 'Apple splash', render: (line: Line) => <VariantA line={line} /> },
  B: { name: 'Large mark, sliding line', render: (line: Line) => <VariantB line={line} /> },
  C: { name: 'Terminal line', render: (line: Line) => <VariantC line={line} /> },
} as const;
type VariantKey = keyof typeof VARIANTS;
const KEYS = Object.keys(VARIANTS) as VariantKey[];

// --- The screen and the bar -------------------------------------------------------------------------------------

/** The loading screen over the board: it ends once the load is done and the mark has finished drawing. */
function LoadingScreen({ variant, run, speed, error, onGone }: { variant: VariantKey; run: number; speed: Speed; error: boolean; onGone: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const line = useFakeLoad(run, speed, error, useCallback(() => setLoaded(true), []));
  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(() => setDrawn(true), reduce ? 0 : Math.max(DRAW_MS, SETTLE_MS));
    return () => clearTimeout(t);
  }, []);
  const leaving = loaded && drawn;
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(onGone, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, onGone]);
  return (
    <div className={`proto-screen ${drawn ? 'is-drawn' : ''} ${leaving ? 'is-leaving' : ''}`} role="status">
      {VARIANTS[variant].render(line)}
    </div>
  );
}

function Bar(props: { variant: VariantKey; setVariant: (v: VariantKey) => void; speed: Speed; setSpeed: (s: Speed) => void; replay: (error?: boolean) => void; theme: string; toggleTheme: () => void; phase: string }) {
  const { variant, setVariant } = props;
  const step = (d: number) => setVariant(KEYS[(KEYS.indexOf(variant) + d + KEYS.length) % KEYS.length]!);
  return (
    <div className="proto-bar">
      <button onClick={() => step(-1)} aria-label="Previous variant">‹</button>
      <span className="proto-bar-label">{variant} · {VARIANTS[variant].name}</span>
      <button onClick={() => step(1)} aria-label="Next variant">›</button>
      <span className="proto-bar-sep" />
      <button onClick={() => props.replay()}>Replay</button>
      <button className={props.speed === 'fresh' ? 'is-on' : ''} onClick={() => props.setSpeed('fresh')}>Fresh install</button>
      <button className={props.speed === 'warm' ? 'is-on' : ''} onClick={() => props.setSpeed('warm')}>Warm start</button>
      <button onClick={() => props.replay(true)}>Show error</button>
      <button onClick={props.toggleTheme}>{props.theme === 'dark' ? 'Light' : 'Dark'}</button>
      <span className="proto-bar-state">{props.phase}</span>
    </div>
  );
}

function Prototype() {
  const params = new URLSearchParams(location.search);
  const initial = params.get('variant')?.toUpperCase();
  const [variant, setVariantState] = useState<VariantKey>(KEYS.includes(initial as VariantKey) ? (initial as VariantKey) : 'A');
  const [speed, setSpeedState] = useState<Speed>(params.get('speed') === 'warm' ? 'warm' : 'fresh');
  const [run, setRun] = useState(1);
  const [error, setError] = useState(false);
  const [showing, setShowing] = useState(true);
  const [theme, setTheme] = useState(() => params.get('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => void (document.documentElement.dataset.protoTheme = theme), [theme]);

  const replay = useCallback((withError = false) => {
    setError(withError);
    setRun((r) => r + 1);
    setShowing(true);
  }, []);
  const setParam = (key: string, value: string) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
  };
  const setVariant = (v: VariantKey) => {
    setVariantState(v);
    setParam('variant', v);
    replay();
  };
  const setSpeed = (s: Speed) => {
    setSpeedState(s);
    setParam('speed', s);
    replay();
  };
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

  const onGone = useCallback(() => setShowing(false), []);
  return (
    <>
      <App />
      {showing && <LoadingScreen key={`${run}-${variant}`} variant={variant} run={run} speed={speed} error={error} onGone={onGone} />}
      <Bar variant={variant} setVariant={setVariant} speed={speed} setSpeed={setSpeed} replay={replay} theme={theme} toggleTheme={toggleTheme} phase={showing ? `loading (${speed}${error ? ', error' : ''})` : 'board'} />
    </>
  );
}

createRoot(document.getElementById('app')!).render(<Prototype />);
