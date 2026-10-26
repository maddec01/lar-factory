// Text helpers the server and the page share: times, durations, counts, token counts and costs.

/** A running time in whole minutes: `12m`, `1h 5m`. */
export function duration(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const INTEGER = new Intl.NumberFormat('en-US');

/**
 * A compact token count as T3 Code's usage page shows it: 980, 40.2K, 12.4M.
 * Ported from `formatTokens` in pingdotgg/t3code packages/shared/src/usageFormat.ts
 * (main at f054d1b8018721bd997d99cbb918a7b17bf098a4).
 */
export function formatTokens(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trimDigits(value / 1e12)}T`;
  if (abs >= 1e9) return `${trimDigits(value / 1e9)}B`;
  if (abs >= 1e6) return `${trimDigits(value / 1e6)}M`;
  if (abs >= 1e3) return `${trimDigits(value / 1e3)}K`;
  return INTEGER.format(Math.round(value));
}

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A cost as T3 Code's usage page shows it: $41.20. Ported from `formatUsd` in the same file and commit. */
export function formatUsd(value: number): string {
  return CURRENCY.format(value);
}

const WHOLE_DOLLARS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** A cost to the nearest whole dollar, `<$1` below a dollar: $41, $1,235. */
export function wholeUsd(value: number): string {
  return value < 1 ? '<$1' : WHOLE_DOLLARS.format(Math.round(value));
}

function trimDigits(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toFixed(digits).replace(/\.0+$/, '');
}

export function clock(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

/** A day as `19 Oct`, with its year, `19 Oct 2025`, when that isn't the year at `now` in the same time zone. */
export function day(iso: string, timeZone: string | undefined, now = Date.now()): string {
  const date = new Date(iso);
  const year = (time: Date | number) => new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone }).format(time);
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', ...(year(date) !== year(now) && { year: 'numeric' }), timeZone })
    .format(date);
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** An age in its largest whole unit, rounded down: `12s ago`, `3m ago`, `2h ago`, `2d ago`. */
export function shortAgo(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

export function elapsed(iso: string, now: number): string {
  return duration(now - Date.parse(iso));
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
