# Onboarding asks one question per step, and the rest when needed

Settled in [#691](https://github.com/maddec01/lar-factory/issues/691), built in [#694](https://github.com/maddec01/lar-factory/issues/694).

The onboarding wizard opens with a detection step listing what it found, each fact or Refused with why. Each later step asks one question, preselects one answer from what was detected, and gives each option one short cost line, with Refused where access blocks it. A step names each choice it leaves for later in one line, and the feature that needs that choice asks for it in the same style when first used. The user chose this over accepting a summary, asking only about unknowns, longer consequence panels and one list of deferred choices at the end.

This replaces the presentation of mandatory labels, cleanup and the setup PR in [ADR 0022](0022-onboarding-writes-the-factorys-agent-setup-and-lands-cleanup-through-a-pr.md).
