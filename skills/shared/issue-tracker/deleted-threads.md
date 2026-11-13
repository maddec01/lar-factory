# Deleted threads

When T3 confirms that an active item's latest shaping or build thread was
deleted and none of its threads is live, details shows Start again, Back to
Queue and Back to List. A closed-PR notice takes precedence. Failed actions
keep the deleted-thread notice and report the error.

Moving back with a passing brief asks whether to keep it passing or Reshape.
Reshape preserves the text, gate history and ticket Spec, and requires a new
passing gate. Moving back a build deletes its slices and clears its phase.
