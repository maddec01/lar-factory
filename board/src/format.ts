// Text helpers the server and the page share: HTML escaping, durations, token counts and costs.

export function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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
