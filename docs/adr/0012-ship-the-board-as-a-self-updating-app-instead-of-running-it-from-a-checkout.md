# Ship the board as a self-updating app instead of running it from a checkout

Settled in [issue #129](https://github.com/maddec01/lar-factory/issues/129) and first built in [issue #203](https://github.com/maddec01/lar-factory/issues/203).

The launch-agent board runs from Pedro's lar-factory checkout and updates by git, so local edits, other branches and diverged commits break Update, and nobody else can install it without a dev setup. We ship the board as a desktop app that CI releases when Pedro starts a Release, Nightly or Stable, and that updates itself from those Releases.

Amended by [issue #232](https://github.com/maddec01/lar-factory/issues/232): CI builds a Release only when Pedro starts one, instead of on every green merge to main. Each Release is a ~150 MB update for every installed app, and a busy day merges many PRs ([issue #129](https://github.com/maddec01/lar-factory/issues/129), Q21).

## Considered options

A separate clone that only Update touches was rejected because teammates would still need git, pnpm and a launch agent.
