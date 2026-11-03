// Names what blocks the board's thread while it starts. Each figure means one thing:
// - A span's time is synchronous and its own, leaving out any span nested in it.
// - A stall is a gap between this trace's timer ticks, so it counts everything on the thread, whoever ran it.
// - Loop delay is Node's whole-process histogram, which includes the timer's own resolution.
// - CPU is process.cpuUsage's, as Node 22 has no per-thread figure: during synchronous work, this thread plus any libuv and GC threads.
// A stats read's elapsed and CPU figures say neither: its elapsed time includes its yields, and its CPU is the whole process's.

import { monitorEventLoopDelay, performance, PerformanceObserver } from 'node:perf_hooks';
import { clearInterval as clearTimer, setInterval as setTimer } from 'node:timers';

/** A gap this much longer than the tick logs a line of its own. */
const STALL_MS = 50;
const TICK_MS = 10;
const WINDOW_MS = 5_000;
/** The trace ends this long after listening, past any startup, so a settled board spends nothing on it. */
const TRACE_MS = 180_000;
/** A window names this many labels, the most time first. */
const WINDOW_LABELS = 8;

const FIGURES = 'figures: "sync" and each label in a "loop stall" are synchronous time of that work alone; "loop stall" and "loop delay" count the whole thread, whoever ran; "unlabelled" is stall time no label covers; "stats read path" elapsed includes its yields and whatever ran during them, its CPU is the whole process\'s, and its "longest block" is synchronous; "cpu" is process.cpuUsage over the same time, so this thread plus any libuv and GC threads: wall far above CPU means the machine or a kernel call held the thread, wall near CPU means the board\'s own work; "gc" in a stall is the GC the observer reported inside it, and the line waits one tick for that report';

interface LabelTotal { ms: number; cpuMs: number; count: number; longestMs: number }

/** Time and CPU together, in milliseconds. */
interface Spent { ms: number; cpuMs: number }

interface HeldStall { line: string; labelCpu: string; from: number; to: number }

type DelayHistogram = Pick<ReturnType<typeof monitorEventLoopDelay>, 'enable' | 'disable' | 'reset' | 'max' | 'percentile'>;

export interface LoopTraceOptions {
  /** Writes one line; the board's gives it the `startup <n> ms:` prefix. */
  write?: (line: string) => void;
  now?: () => number;
  delay?: DelayHistogram;
  /** CPU used so far, in milliseconds. */
  cpu?: () => number;
  /** Reports each GC's start and length, and gives how to stop. */
  watchGc?: (report: (startedAt: number, ms: number) => void) => () => void;
}

export interface LoopTrace {
  /** Runs synchronous work under a label. */
  span<T>(label: string, work: () => T): T;
  /** Records a synchronous block timed elsewhere, leaving out the spans since `spannedAt`, a value `spanned` gave as it began. */
  block(label: string, ms: number, spannedAt: Spent, cpuMs: number): void;
  /** All span time and CPU so far. */
  spanned(): Spent;
  /** Logs a request slower than a stall, with how long it waited for the first tool check. */
  request(name: string, ms: number, gateMs: number): void;
  /** Starts the timers once the server listens, and sets where the log's times count from. */
  begin(write: (line: string) => void, listeningAt: number): void;
  /** Looks for a stall since the last tick. */
  tick(): void;
  /** Logs the window ending now. */
  endWindow(): void;
  /** Stops the trace, with a line for the whole of it. */
  end(): void;
}

const round = Math.round;

const processCpu = () => {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
};

const observeGc: NonNullable<LoopTraceOptions['watchGc']> = (report) => {
  const observer = new PerformanceObserver((entries) => {
    for (const { startTime, duration } of entries.getEntries()) report(startTime, duration);
  });
  observer.observe({ entryTypes: ['gc'] });
  return () => observer.disconnect();
};

export function createLoopTrace({ write: given, now = () => performance.now(), delay = monitorEventLoopDelay({ resolution: TICK_MS }), cpu = processCpu, watchGc = observeGc }: LoopTraceOptions = {}): LoopTrace {
  let write = given ?? (() => {});
  let active = true;
  let origin = 0;
  let spannedMs = 0;
  let spannedCpuMs = 0;
  /** The running spans' time and CPU in spans nested in them, innermost last. */
  const stack: Spent[] = [];
  const windowTotals = new Map<string, LabelTotal>();
  const allTotals = new Map<string, LabelTotal>();
  /** Each label's time since the last tick. */
  let sinceTick = new Map<string, Spent>();
  let lastTick = 0;
  let lastCpu = 0;
  let windowAt = 0;
  let windowCpu = 0;
  let startCpu = 0;
  /** The stall waiting for the observer's report of the GC inside it, which comes after the stall. */
  let held: HeldStall | undefined;
  /** The GCs a stall may still count. */
  let recentGc: { startedAt: number; ms: number }[] = [];
  let gcMs = 0;
  let gcLongestMs = 0;
  let maxDelayMs = 0;
  const timers: NodeJS.Timeout[] = [];
  let stopGc: (() => void) | undefined;

  const add = (totals: Map<string, LabelTotal>, label: string, ms: number, cpuMs: number) => {
    const total = totals.get(label) ?? { ms: 0, cpuMs: 0, count: 0, longestMs: 0 };
    total.ms += ms;
    total.cpuMs += cpuMs;
    total.count++;
    total.longestMs = Math.max(total.longestMs, ms);
    totals.set(label, total);
  };
  const record = (label: string, ms: number, cpuMs: number) => {
    spannedMs += ms;
    spannedCpuMs += cpuMs;
    add(windowTotals, label, ms, cpuMs);
    add(allTotals, label, ms, cpuMs);
    const since = sinceTick.get(label) ?? { ms: 0, cpuMs: 0 };
    sinceTick.set(label, { ms: since.ms + ms, cpuMs: since.cpuMs + cpuMs });
  };
  const topLabels = (totals: Map<string, LabelTotal>) => [...totals].sort(([, a], [, b]) => b.ms - a.ms).slice(0, WINDOW_LABELS);
  const named = (totals: Map<string, LabelTotal>) => topLabels(totals)
    .map(([label, { ms, count, longestMs }]) => `${label} ${round(ms)} ms over ${count}, longest ${round(longestMs)} ms`).join('; ') || 'none';
  const namedCpu = (totals: Map<string, LabelTotal>) => topLabels(totals).map(([label, { cpuMs }]) => `${label} ${round(cpuMs)} ms`).join(', ') || 'none';
  const writeHeld = () => {
    if (!held) return;
    const { line, labelCpu, from, to } = held;
    const gcInside = recentGc.reduce((sum, { startedAt, ms }) => sum + Math.max(0, Math.min(startedAt + ms, to) - Math.max(startedAt, from)), 0);
    held = undefined;
    write(`${line}, gc ${round(gcInside)} ms; label cpu: ${labelCpu}`);
  };

  const trace: LoopTrace = {
    span(label, work) {
      if (!active) return work();
      const startedAt = now();
      const startedCpu = cpu();
      stack.push({ ms: 0, cpuMs: 0 });
      try {
        return work();
      } finally {
        const ms = now() - startedAt;
        const cpuMs = cpu() - startedCpu;
        const nested = stack.pop()!;
        record(label, ms - nested.ms, cpuMs - nested.cpuMs);
        const outer = stack.at(-1);
        if (outer) {
          outer.ms += ms;
          outer.cpuMs += cpuMs;
        }
      }
    },
    block(label, ms, spannedAt, cpuMs) {
      if (!active) return;
      const own = ms - (spannedMs - spannedAt.ms);
      if (own <= 0) return;
      const ownCpu = Math.max(0, cpuMs - (spannedCpuMs - spannedAt.cpuMs));
      record(label, own, ownCpu);
      const outer = stack.at(-1);
      if (outer) {
        outer.ms += own;
        outer.cpuMs += ownCpu;
      }
    },
    spanned: () => ({ ms: spannedMs, cpuMs: spannedCpuMs }),
    request(name, ms, gateMs) {
      if (active && ms >= STALL_MS) write(`request ${name} took ${round(ms)} ms, ${round(gateMs)} ms of it waiting for the first tool check`);
    },
    begin(writer, listeningAt) {
      write = writer;
      origin = listeningAt;
      lastTick = windowAt = now();
      lastCpu = windowCpu = startCpu = cpu();
      write(`listening ${round(listeningAt)} ms after the process started`);
      write(FIGURES);
      delay.enable();
      stopGc = watchGc((startedAt, ms) => {
        gcMs += ms;
        gcLongestMs = Math.max(gcLongestMs, ms);
        recentGc.push({ startedAt, ms });
      });
      // From node:timers, so a test's faster clock leaves the trace's pace alone.
      timers.push(setTimer(trace.tick, TICK_MS).unref(), setTimer(trace.endWindow, WINDOW_MS).unref(), setTimer(trace.end, TRACE_MS).unref());
    },
    tick() {
      const at = now();
      const cpuAt = cpu();
      writeHeld();
      recentGc = recentGc.filter(({ startedAt, ms }) => startedAt + ms > lastTick);
      const gap = at - lastTick - TICK_MS;
      if (gap >= STALL_MS) {
        const labels = [...sinceTick].sort(([, a], [, b]) => b.ms - a.ms);
        const stallCpu = cpuAt - lastCpu;
        const unlabelled = gap - labels.reduce((sum, [, { ms }]) => sum + ms, 0);
        const unlabelledCpu = stallCpu - labels.reduce((sum, [, { cpuMs }]) => sum + cpuMs, 0);
        const parts = [...labels.filter(([, { ms }]) => ms >= 1).map(([label, { ms }]) => `${label} ${round(ms)} ms`), ...unlabelled >= 1 ? [`unlabelled ${round(unlabelled)} ms`] : []];
        const cpuParts = [...labels.filter(([, { ms }]) => ms >= 1).map(([label, { cpuMs }]) => `${label} ${round(cpuMs)} ms`), ...unlabelledCpu >= 1 ? [`unlabelled ${round(unlabelledCpu)} ms`] : []];
        held = { line: `loop stall ${round(gap)} ms from ${round(lastTick - origin)} ms: ${parts.join(', ')}; cpu ${round(stallCpu)} ms`, labelCpu: cpuParts.join(', ') || 'none', from: lastTick, to: at };
      }
      lastTick = at;
      lastCpu = cpuAt;
      sinceTick = new Map();
    },
    endWindow() {
      const at = now();
      const cpuAt = cpu();
      const maxMs = delay.max / 1e6;
      maxDelayMs = Math.max(maxDelayMs, maxMs);
      write(`loop window ${round(windowAt - origin)} to ${round(at - origin)} ms: loop delay max ${round(maxMs)} ms, p99 ${round(delay.percentile(99) / 1e6)} ms; GC ${round(gcMs)} ms, longest ${round(gcLongestMs)} ms; sync: ${named(windowTotals)}; process cpu ${round(cpuAt - windowCpu)} ms; sync cpu: ${namedCpu(windowTotals)}`);
      windowAt = at;
      windowCpu = cpuAt;
      windowTotals.clear();
      gcMs = gcLongestMs = 0;
      delay.reset();
    },
    end() {
      if (!active) return;
      writeHeld();
      trace.endWindow();
      active = false;
      for (const timer of timers) clearTimer(timer);
      delay.disable();
      stopGc?.();
      write(`loop trace ended: loop delay max ${round(maxDelayMs)} ms; sync: ${named(allTotals)}; process cpu ${round(cpu() - startCpu)} ms; sync cpu: ${namedCpu(allTotals)}`);
    },
  };
  return trace;
}

/** The board's one trace. */
export const loopTrace = createLoopTrace();
