// The page the window shows from launch until the board server is ready, so an app opened from Finder always has
// a window. It is the loading screen apps/web/src/loading draws on the board page: the L draws itself once, here,
// and the board page opens on it finished (boardUrl). The main process sends each step and a failed start's error
// to the open page without reloading it, so the mark never redraws.
import { BRAND_BLOCK_COLOR, BRAND_MARK_BAR, BRAND_MARK_BLOCK, BRAND_MARK_CENTRE_LINE, BRAND_MARK_L, BRAND_MARK_VIEWBOX } from "@lar-factory/shared";

import css from "./starting-page.css?compiled";

/** The launch's steps in order; the board page's loading screen names the steps after these. */
export const STEPS = {
  shell: "Reading the shell environment",
  server: "Starting the board server",
  healthz: "Waiting for the board server",
  tools: "Checking gh and tools",
} as const;

/** How long the old line rolls out, as the board page's (apps/web/src/loading/loading-screen.tsx). */
const ROLL_MS = 380;

// The page's one script. `step` rolls the new line in as the old rolls out, or swaps it with reduced motion;
// `error` shows the error line in place of the step line, and the next step brings the step line back.
const script = `(() => {
  const slot = document.getElementById("slot");
  const stepLine = document.getElementById("step");
  const errorLine = document.getElementById("error");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.larLoading = {
    step(text) {
      errorLine.hidden = true;
      stepLine.hidden = false;
      const now = slot.lastElementChild;
      if (now.textContent === text) return;
      for (const old of [...slot.children]) if (old !== now) old.remove();
      const next = document.createElement("span");
      next.textContent = text;
      if (reduced) return slot.replaceChildren(next);
      now.className = "loading-roll-out";
      next.className = "loading-roll-in";
      slot.append(next);
      setTimeout(() => now.remove(), ${ROLL_MS});
    },
    error(text) {
      errorLine.textContent = text;
      errorLine.hidden = false;
      stepLine.hidden = true;
    },
  };
})();`;

/** A data: URL for the starting page, which opens on the first step. */
export const url = (): string => {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lar Factory</title>
<style>${css}</style></head>
<body><main class="loading-lockup" role="status">
<div class="loading-wordmark"><svg class="loading-mark" viewBox="${BRAND_MARK_VIEWBOX}" aria-hidden="true">
<path class="loading-mark-block" d="${BRAND_MARK_BLOCK}" fill="${BRAND_BLOCK_COLOR}"/>
<path class="loading-mark-trace" d="${BRAND_MARK_CENTRE_LINE}" pathLength="1" fill="none" stroke="currentColor" stroke-width="${BRAND_MARK_BAR}" stroke-linecap="round" stroke-linejoin="round"/>
<path class="loading-mark-fill" d="${BRAND_MARK_L}" fill="currentColor"/>
</svg><span class="loading-lar">lar</span><span class="loading-factory">Factory</span></div>
<p class="loading-line" id="step"><span class="loading-line-slot" id="slot"><span>${STEPS.shell}</span></span></p>
<p class="loading-line loading-error" id="error" hidden></p>
</main><script>${script}</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};

// A message runs in the page, which may be another page by then (the board's): `?.` leaves that one alone.
/** The script that shows `step` on the open starting page. */
export const stepScript = (step: string): string => `window.larLoading?.step(${JSON.stringify(step)})`;

/** The script that shows why the last start failed on the open starting page, in place of the step line. */
export const errorScript = (reason: string): string =>
  `window.larLoading?.error(${JSON.stringify(`The board server didn't start: ${reason}. Trying again.`)})`;

/** How long the mark takes to draw, as the board page's (apps/web/src/loading/loading-screen.tsx). */
export const DRAW_MS = 1300;

/**
 * How long to wait before the board page may open on the finished mark: what is left of the draw since the starting
 * page showed (`shownAt`, undefined until it has loaded), so the mark never jumps to finished.
 */
export const drawWait = (shownAt: number | undefined, now: number): number =>
  shownAt === undefined ? DRAW_MS : Math.min(DRAW_MS, Math.max(0, shownAt + DRAW_MS - now));

/** The board's page, told by the flag that this page drew the mark already, so it opens on the finished mark. */
export const boardUrl = (board: URL): string => {
  const url = new URL(board);
  url.searchParams.set("loading", "drawn");
  return url.href;
};
