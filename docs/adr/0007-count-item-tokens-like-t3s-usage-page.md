# Count item tokens and cost like T3's usage page

Amends [ADR 0005](0005-read-item-stats-from-t3s-database.md), settled in [issue #76](https://github.com/maddec01/mux-factory/issues/76).

Item tokens and API cost are read from the providers' transcripts of each item's T3 threads and priced with T3's own rate table and overrides, by porting T3's usage rules. The token counts in T3's database are no longer used. That database lacks a model for some turns and never matches T3's usage page, and the board must show the same values as T3 Code, which it is becoming an extension of. T3's database stays the source of agent time and the thread→transcript mapping.

The first load reads the transcripts of every thread, since a record counts once across all of them; that takes seconds on a cold start, and later loads hit a cache of each file's records. A merged item's frozen figures are read from the stats block in its most recently merged PR's body, so they trust that PR body.
