# Copies are taken whole, and Overrides set aside what doesn't fit

Settled in issue #357.

skill-sync takes an upstream change to a Copy whole or not at all, and lar sets aside the parts that work against the factory with Overrides in its own skills. Taking only some hunks left Copies that matched no upstream commit and hid the left-out hunks from every later sync. Whole takes keep each Copy checkable against upstream and keep lar's rules in lar's files, at the cost of shipping upstream text that an Override then cancels.
