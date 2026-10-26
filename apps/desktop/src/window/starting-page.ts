// The page the window shows from launch until the board server is ready, so an app
// opened from Finder always has a window, and one whose server won't start says why.
import css from "./starting-page.css?compiled";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A data: URL for the starting page; with `error`, it shows why the last start failed. */
export const url = (error?: string): string => {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lar Factory</title>
<style>${css}</style></head>
<body><p><strong>Starting board…</strong></p>${
    error === undefined ? "" : `<p class="error">The board server didn't start: ${escape(error)}. Trying again.</p>`
  }</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
};
