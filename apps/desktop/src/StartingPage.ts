// The page the window shows from launch until the board server is ready, so an app
// opened from Finder always has a window, and one whose server won't start says why.

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A data: URL for the starting page; with `error`, it shows why the last start failed. */
export const url = (error?: string): string => {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mux Factory</title>
<meta name="color-scheme" content="light dark">
<style>
  html, body { height: 100%; margin: 0; }
  /* The whole page drags the window, as the board's title bar does. */
  body { display: grid; place-content: center; gap: 8px; padding: 52px 24px 24px; box-sizing: border-box;
    font: 14px/1.5 -apple-system, system-ui, sans-serif; text-align: center; -webkit-app-region: drag; user-select: none; }
  p { margin: 0; max-width: 560px; }
  /* The error stays selectable, so it can be copied. */
  .error { color: GrayText; overflow-wrap: anywhere; -webkit-app-region: no-drag; user-select: text; }
</style></head>
<body><p><strong>Starting board…</strong></p>${
    error === undefined ? "" : `<p class="error">The board server didn't start: ${escape(error)}. Trying again.</p>`
  }</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};
