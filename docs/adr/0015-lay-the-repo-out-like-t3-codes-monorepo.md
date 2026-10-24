# Lay the repo out like T3 Code's monorepo

Settled in [issue #269](https://github.com/maddec01/mux-factory/issues/269).

mux-factory is a pnpm workspace shaped like T3 Code: `apps/server`, `apps/web` and `apps/desktop`, and `packages/ui` and `packages/shared`. Apps import only packages, never each other. We mirror T3 so copied T3 code keeps its paths and ports stay mechanical, at the cost of five package configs for a small app.
