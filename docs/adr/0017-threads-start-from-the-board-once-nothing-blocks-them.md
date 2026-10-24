# Threads start from the board, once nothing blocks them

Settled in issue #167.

A shaping thread stops at Ready instead of launching its build, and a concept's decision and build threads start from the board, not from the thread that created them. A part blocked by another issue starts only once that issue closes, by hand or through Start after; this replaces starting every build at once. Pedro sees what is ready and decides when each thread starts, so no thread sits waiting for him to say continue, and no build runs against work that may still change. The cost is one click per build, and coupled builds run one after another instead of side by side.
