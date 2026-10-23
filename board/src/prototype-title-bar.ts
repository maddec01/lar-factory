// PROTOTYPE (#183), throwaway: three looks for the board app's Mac title bar, switched with
// ?variant=a|b|c and the floating bar at the bottom (or the ← → keys). Not for main.
// Matches T3 Code's window: titleBarStyle "hiddenInset", trafficLightPosition { x: 16, y: 52 / 2 - 7 },
// a 52 px HTML drag bar, and the brand row from apps/web/src/components/sidebar/SidebarChrome.tsx
// (text-sm font-medium tracking-tight, muted second word, Badge size "sm" variant "secondary").
// A browser has no window buttons, so the bar draws the traffic lights where macOS puts them.

import { BRAND_MARK } from './render.ts';

const css = `
body { padding-top: 52px; }
.tb { position: fixed; inset: 0 0 auto 0; z-index: 50; height: 52px; display: flex; align-items: center; gap: 8px;
  padding: 0 12px 0 80px; background: var(--bg); border-bottom: 1px solid var(--bd); -webkit-app-region: drag; user-select: none; }
.tb > * { -webkit-app-region: initial; }
.tb button, .tb a { -webkit-app-region: no-drag; }
/* macOS draws these: 12 px circles on a 20 px pitch, the group's left edge at x 16, centred in 52 px. */
.tb-lights { position: absolute; left: 16px; top: 19px; display: flex; gap: 6px; padding: 1px; }
.tb-lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 18%); }
.tb-lights i:nth-child(1) { background: #ff5f57; } .tb-lights i:nth-child(2) { background: #febc2e; } .tb-lights i:nth-child(3) { background: #28c840; }
.tb-brand { display: inline-flex; align-items: baseline; gap: 4px; font-size: 14px; font-weight: 500; letter-spacing: -0.025em; color: var(--fg); text-decoration: none; }
.tb-brand .brand-mark { width: 22px; height: 12.5px; top: calc(12.5px * 8.75 / 32); }
.tb-word { color: var(--muted); }
.tb-badge { display: inline-flex; align-items: center; height: 16px; padding: 0 3px; border-radius: 0.25rem; border: 1px solid transparent;
  font-size: 10px; font-weight: 500; line-height: 1; white-space: nowrap; background: var(--muted-bg); color: var(--fg); margin-left: 4px; }
.tb-spacer { flex: 1; }
.title-row h1 { display: none; }

/* B: outline badge, update icon at the right end with the changelog on hover. */
.tb-b .tb-badge { border-color: var(--input); background: var(--surface); color: var(--muted); }
.tb-update { position: relative; }
.tb-icon { width: 28px; height: 28px; display: grid; place-items: center; border: 0; border-radius: var(--r-control); background: none; color: var(--muted); cursor: pointer; }
.tb-icon:hover, .tb-update:focus-within .tb-icon { background: var(--accent); color: var(--fg); }
.tb-icon svg { width: 16px; height: 16px; }
.tb-dot { position: absolute; top: 5px; right: 5px; width: 6px; height: 6px; border-radius: 50%; background: var(--primary); box-shadow: 0 0 0 2px var(--bg); }
.tb-log { display: none; position: absolute; right: 0; top: 34px; width: 300px; padding: 10px 12px; border: 1px solid var(--bd); border-radius: var(--r);
  background: var(--surface); box-shadow: var(--shadow); font-size: 12px; color: var(--fg); }
.tb-update:hover .tb-log, .tb-update:focus-within .tb-log, .tb-log-open .tb-log { display: block; }
.tb-log b { display: block; font-size: 13px; }
.tb-log .tb-sub { color: var(--muted); margin: 0 0 8px; }
.tb-log ul { margin: 0 0 10px; padding-left: 16px; } .tb-log li { margin: 2px 0; }
.tb-log code { font-size: 11px; }

/* C: bigger logo, tinted badge, and the header's controls move up into the bar; the page drops its title row. */
.tb-c .tb-brand { font-size: 15px; font-weight: 600; gap: 6px; }
.tb-c .tb-brand .brand-mark { width: 28px; height: 16px; top: calc(16px * 8.75 / 32); }
.tb-c .tb-word { color: var(--fg); }
.tb-c .tb-badge { background: color-mix(in srgb, var(--primary) 10%, transparent); color: var(--info-fg); }
body.tb-v-c .title-row { height: 0; }
body.tb-v-c .refreshed { position: fixed; z-index: 51; top: 0; left: 50%; transform: translateX(-50%); line-height: 52px;
  font-size: 12px; white-space: nowrap; }
body.tb-v-c .header-actions { position: fixed; z-index: 51; top: 14px; right: 12px; }
body.tb-v-c .totals { margin-top: 0; }

/* The switcher is not part of the design. */
.proto-switch { position: fixed; z-index: 99; bottom: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 4px;
  padding: 4px; border-radius: 999px; background: #111; color: #fff; font: 12px/1 var(--font-sans); box-shadow: 0 6px 20px rgb(0 0 0 / 35%); outline: 1px solid rgb(255 255 255 / 15%); }
.proto-switch button { border: 0; background: none; color: inherit; width: 28px; height: 28px; border-radius: 50%; cursor: pointer; font-size: 14px; }
.proto-switch button:hover { background: rgb(255 255 255 / 15%); }
.proto-switch span { padding: 0 8px; white-space: nowrap; }
`;

const UPDATE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8v8"/><path d="m8 12 4 4 4-4"/></svg>';

const lights = '<div class="tb-lights" aria-hidden="true"><i></i><i></i><i></i></div>';
const brand = `<a class="tb-brand" href="/">${BRAND_MARK}<span class="tb-word">Factory</span></a><span class="tb-badge">for T3 Code</span>`;
const update = `<div class="tb-update"><button type="button" class="tb-icon" aria-label="Update available: see what changed">${UPDATE_ICON}</button><span class="tb-dot"></span>
<div class="tb-log" role="tooltip"><b>Update available</b><p class="tb-sub">3 new commits since your board's version</p>
<ul><li>Push the board data to open pages over server-sent events</li><li>Read GitHub at once after status.sh moves an item</li><li>Copy UPSTREAM.md into the update tests</li></ul>
<button type="button" class="copy">Update and restart</button></div></div>`;

const VARIANTS: Record<string, { name: string; bar: string }> = {
  a: { name: 'T3 match', bar: `${lights}${brand}` },
  b: { name: 'Update icon in bar', bar: `${lights}${brand}<span class="tb-spacer"></span>${update}` },
  c: { name: 'Header controls in bar', bar: `${lights}${brand}` },
};

/** The styles and the slots for the bar and the switcher, placed at the top of <body>; the script below fills them. */
export function renderPrototypeTitleBar(): string {
  return `<style>${css}</style>
<div id="tb-root"></div>
<div class="proto-switch"><button type="button" data-step="-1" aria-label="Previous variant">←</button><span id="tb-label"></span><button type="button" data-step="1" aria-label="Next variant">→</button></div>
<script type="module" src="/assets/prototype-title-bar.ts"></script>`;
}

// In the browser (the server sends this file as /assets/prototype-title-bar.ts): show ?variant= and switch with ← →.
if (typeof document !== 'undefined') {
  const keys = Object.keys(VARIANTS);
  const show = (key: string): string => {
    const v = VARIANTS[key] ? key : 'a';
    document.getElementById('tb-root')!.innerHTML = `<div class="tb tb-${v}">${VARIANTS[v]!.bar}</div>`;
    document.getElementById('tb-label')!.textContent = `${v.toUpperCase()} (${VARIANTS[v]!.name})`;
    // ?log=1 pins B's changelog open, for a screenshot.
    if (new URLSearchParams(location.search).has('log')) document.querySelector('.tb-update')?.classList.add('tb-log-open');
    for (const k of keys) document.body.classList.toggle(`tb-v-${k}`, k === v);
    return v;
  };
  let current = show(new URLSearchParams(location.search).get('variant') ?? 'a');
  const step = (by: number) => {
    current = show(keys[(keys.indexOf(current) + by + keys.length) % keys.length]!);
    const url = new URL(location.href);
    url.searchParams.set('variant', current);
    history.replaceState(null, '', url);
  };
  document.querySelector('.proto-switch')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-step]');
    if (b) step(Number(b.dataset.step));
  });
  addEventListener('keydown', (e) => {
    if ((e.target as Element).closest('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  });
}
