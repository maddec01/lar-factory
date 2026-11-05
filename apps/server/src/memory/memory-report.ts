// Turns one run's memory samples and footprint captures into the figures the run reports, and names what holds the
// memory using the forced GC nearest the highest RSS sample.

import type { MemorySample } from './memory-sampler.ts';

export interface Capture {
  time: number;
  /** What `footprint -j` wrote. */
  footprint: string;
}

interface Region {
  name: string;
  bytes: number;
}

interface Footprint {
  total: number;
  regions: Region[];
}

/** The footprint's total and each region's dirty plus swapped bytes, as the total counts them, the largest first; null when the text isn't a footprint. */
export function footprintRegions(text: string): Footprint | null {
  let process: { footprint: number; categories: Record<string, { dirty: number; swapped: number }> } | undefined;
  try {
    process = (JSON.parse(text) as { processes: NonNullable<typeof process>[] }).processes[0];
  } catch {
    return null;
  }
  if (!process) return null;
  const regions = Object.entries(process.categories).map(([name, { dirty, swapped }]) => ({ name, bytes: dirty + swapped }));
  return { total: process.footprint, regions: regions.sort((a, b) => b.bytes - a.bytes) };
}

/** The largest regions that together hold at least `share` of the footprint. */
export function regionsHolding({ total, regions }: Footprint, share: number): Region[] {
  const held: Region[] = [];
  let sum = 0;
  for (const region of regions) {
    if (sum >= share * total) break;
    held.push(region);
    sum += region.bytes;
  }
  return held;
}

/** RSS's peak, low and end, in bytes, and each PID that wrote a sample. */
export function summarize(samples: readonly MemorySample[]) {
  const highest = highestRss(samples);
  return {
    peak: highest.rss,
    peakAt: highest.time,
    low: Math.min(...samples.map((sample) => sample.rss)),
    end: samples.at(-1)!.rss,
    pids: [...new Set(samples.map((sample) => sample.pid))],
  };
}

const highestRss = (samples: readonly MemorySample[]) => samples.reduce((high, sample) => (sample.rss > high.rss ? sample : high));

function nearest<T>(items: readonly T[], time: number, timeOf: (item: T) => number): T | undefined {
  return items.reduce<T | undefined>((near, item) => (near === undefined || Math.abs(timeOf(item) - time) < Math.abs(timeOf(near) - time) ? item : near), undefined);
}

const GROWTH = 1.2;

/** The cause the forced GC nearest the highest RSS sample shows, or null without a forced GC. All its figures come from the sample right after that GC. */
export function conclude(samples: readonly MemorySample[]) {
  const gcs = samples.filter((sample) => sample.kind === 'after-gc');
  const gc = nearest(gcs, Date.parse(highestRss(samples).time), (sample) => Date.parse(sample.time));
  if (!gc) return null;
  const halfRss = gc.rss / 2;
  const cause = gc.heapUsed > halfRss || gcs.at(-1)!.heapUsed >= gcs[0]!.heapUsed * GROWTH
    ? 'JS retention'
    : gc.heapTotal - gc.heapUsed > halfRss ? 'V8 heap slack' : 'allocator or native pages';
  return { cause, gc, firstGc: gcs[0]!, lastGc: gcs.at(-1)! };
}

const mib = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;
const UNIDENTIFIED = /^(App-Specific Tag|Untagged)/;

/** The run's figures as text for the PR. */
export function renderReport(samples: readonly MemorySample[], captures: readonly Capture[]): string {
  if (!samples.length) throw new Error('no samples to report: the board server wrote none');
  const { peak, peakAt, low, end, pids } = summarize(samples);
  const lines = [`${samples.length} samples from ${samples[0]!.time} to ${samples.at(-1)!.time}`];
  if (pids.length > 1) lines.push(`VOID: the server restarted (PIDs ${pids.join(', ')})`);
  lines.push(`RSS peak ${mib(peak)}, range ${mib(low)} to ${mib(peak)}, end ${mib(end)}`);

  const capture = nearest(captures, Date.parse(peakAt), (each) => each.time);
  const footprint = capture && footprintRegions(capture.footprint);
  if (!capture) lines.push('No capture');
  else if (!footprint) lines.push(`Peak capture ${new Date(capture.time).toISOString()} could not be read`);
  else {
    lines.push(`Peak capture ${new Date(capture.time).toISOString()}, footprint ${mib(footprint.total)}, regions holding at least 80%:`);
    for (const { name, bytes } of regionsHolding(footprint, 0.8)) {
      lines.push(`- ${name}: ${mib(bytes)} (${Math.round((bytes / footprint.total) * 100)}%)${UNIDENTIFIED.test(name) ? ', unidentified' : ''}`);
    }
  }

  const conclusion = conclude(samples);
  if (!conclusion) lines.push('No forced GC');
  else {
    const { gc, firstGc, lastGc, cause } = conclusion;
    lines.push(`GC nearest the peak at ${gc.time}: heapUsed after GC ${mib(gc.heapUsed)}, heapTotal slack ${mib(gc.heapTotal - gc.heapUsed)}, external ${mib(gc.external)}, RSS ${mib(gc.rss)}`);
    lines.push(`First GC heapUsed ${mib(firstGc.heapUsed)}, last GC heapUsed ${mib(lastGc.heapUsed)}`);
    lines.push(`Conclusion: ${cause}`);
  }
  return `${lines.join('\n')}\n`;
}
