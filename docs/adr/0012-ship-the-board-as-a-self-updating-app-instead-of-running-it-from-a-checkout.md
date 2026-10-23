# Ship the board as a self-updating app instead of running it from a checkout

Settled in [issue #129](https://github.com/maddec01/mux-factory/issues/129) and first built in [issue #203](https://github.com/maddec01/mux-factory/issues/203).

The launch-agent board runs from Pedro's mux-factory checkout and updates by git, so local edits, other branches and diverged commits break Update, and nobody else can install it without a dev setup. We ship the board as a desktop app that CI releases on every green merge to main and that updates itself from those Releases.

## Considered options

A separate clone that only Update touches was rejected because teammates would still need git, pnpm and a launch agent.
