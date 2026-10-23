# Build the board app on T3 Code's libraries

Settled in [issue #185](https://github.com/maddec01/mux-factory/issues/185) and first built in [issue #187](https://github.com/maddec01/mux-factory/issues/187).

The board app copies its title bar, update flow and changelog popover from T3 Code ([pingdotgg/t3code](https://github.com/pingdotgg/t3code)), which writes them in React, Base UI and Effect and bundles them with Vite+. The board takes on T3's stack so the copied code needs trimming, not rewriting, and later T3 fixes port the same way. The page uses React 19, Vite+, Tailwind 4, Base UI, TanStack Router and zustand. The app's main process uses Effect and Vite+. The board server stays plain `node:http`, as [issue #179](https://github.com/maddec01/mux-factory/issues/179) settled.

## Considered options

Keeping the text-built HTML and rewriting the copied parts in plain TypeScript was rejected. Every piece taken from T3 would need a rewrite and would then drift from upstream.
